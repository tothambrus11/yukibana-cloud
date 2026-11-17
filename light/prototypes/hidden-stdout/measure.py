#!/usr/bin/env python3
"""Runs every language in every arrangement, looks for the canaries of
common/SPEC.md in what the student could see, times the honest runs, and
writes results/results.md and results/results.json.

Arrangements:
  A  inproc   hidden tests, hidden library and the student's code in one
              process, inside the same sandbox as C, with the hidden
              *sources* removed: only what a careful grader would ship
              (Python bytecode without .py, Java class files, a stripped
              C++ binary; JavaScript has no compiled form).
  B  filter   A, with stdout passed through a redaction filter that blanks
              every 8-character window of the hidden sources and every
              number of 4 digits or more in them.
  C  split    the hidden parts in a trusted process, the student's code in
              a sandboxed one, RPC between them over two FIFOs, stdout shown
              unfiltered. split-1cpu: the same with both processes pinned
              to one CPU. split-shm (C++): over one shared-memory mailbox
              with a futex instead of FIFOs.
  D  wasm     freestanding C++ compiled to WebAssembly: one module with one
              memory (mono), or three instances with a memory each (split).

Run as root (the sandbox needs namespaces and setpriv): python3 measure.py
"""

import base64
import binascii
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SANDBOX = os.path.join(HERE, 'common', 'sandbox.sh')
RAW = tempfile.mkdtemp(prefix='hidden-stdout-')
os.chmod(RAW, 0o777)
REPEATS = int(os.environ.get('REPEATS', '3'))
ENV = {'PATH': os.environ['PATH'], 'PYTHONDONTWRITEBYTECODE': '1'}

# What each canary looks like in text, and in a hex dump of little-endian memory.
CANARIES = {
    'library': [r'canary-library-c4e1', r'99357415', r'5ec12e7', r'e712ec05'],
    'test code': [r'canary-test-c0de'],
    'expected value': [r'1769512', r'28001b00'],
    'test input': [r'424242', r'32790600'],
}


def decoded(text: str) -> str:
    """The text, plus every base64 run in it decoded, so an encoded leak counts."""
    extra = []
    for run in re.findall(r'[A-Za-z0-9+/]{16,}={0,2}', text):
        try:
            extra.append(base64.b64decode(run + '=' * (-len(run) % 4), validate=False).decode('latin1'))
        except (binascii.Error, ValueError):
            pass
    return text + '\n' + '\n'.join(extra)


def leaks(text: str) -> dict:
    t = decoded(text).lower()
    return {k: any(re.search(p, t) for p in ps) for k, ps in CANARIES.items()}


class Redactor:
    """Arrangement B's filter: what a grader could do with the hidden sources in hand."""

    def __init__(self, dirs):
        self.grams, self.numbers = set(), set()
        for d in dirs:
            for root, _, files in os.walk(d):
                for f in files:
                    try:
                        with open(os.path.join(root, f), encoding='utf8') as h:
                            s = h.read()
                    except (UnicodeDecodeError, OSError):
                        continue
                    self.grams.update(s[i:i + 8] for i in range(len(s) - 7))
                    self.numbers.update(re.findall(r'\d{4,}', s.replace('_', '')))

    def __call__(self, text: str) -> str:
        mask = bytearray(len(text))
        for i in range(len(text) - 7):
            if text[i:i + 8] in self.grams:
                mask[i:i + 8] = b'\x01' * 8
        for m in re.finditer(r'\d{4,}', text):
            if m.group() in self.numbers:
                mask[m.start():m.end()] = b'\x01' * (m.end() - m.start())
        return ''.join('#' if m else c for c, m in zip(text, mask))


def run(cmd, verdicts, visible=None, env=None, cwd=None):
    """Runs one arrangement; returns (verdict lines, what the student saw)."""
    open(verdicts, 'w').close()
    os.chmod(verdicts, 0o666)
    e = dict(ENV, **(env or {}))
    p = subprocess.run(cmd, capture_output=True, env=e, cwd=cwd, timeout=600)
    seen = p.stdout.decode('latin1') + p.stderr.decode('latin1')
    if visible is not None:
        with open(visible, encoding='latin1') as h:
            seen = h.read()
    with open(verdicts) as h:
        lines = h.read().splitlines()
    return lines, seen


def seconds(lines):
    for line in lines:
        m = re.match(r'perf (\w+) n=\d+ (seconds|us)=([\d.]+)', line)
        if m:
            if m.group(1) != 'pass':
                raise RuntimeError(f'perf failed: {lines}')
            return float(m.group(3)) / (1e6 if m.group(2) == 'us' else 1)
    raise RuntimeError(f'no perf line: {lines}')


def passed(lines):
    return all(' pass' in l for l in lines) and len(lines) == 4


# --- the languages --------------------------------------------------------------

def py():
    d = os.path.join(HERE, 'py')
    compiled = os.path.join(RAW, 'py-compiled')
    shutil.copytree(os.path.join(d, 'hidden'), compiled, ignore=shutil.ignore_patterns('__pycache__'))
    subprocess.run([sys.executable, '-m', 'compileall', '-q', '-b', compiled], check=True)
    for f in os.listdir(compiled):
        if f.endswith('.py'):
            os.remove(os.path.join(compiled, f))
    subprocess.run(['chmod', '-R', 'a+rX', compiled], check=True)
    hidden, student = os.path.join(d, 'hidden'), os.path.join(d, 'student')
    return {
        'name': 'Python', 'hidden': [hidden],
        'inproc': lambda v, verdicts, env: run([SANDBOX, hidden, '--', sys.executable, os.path.join(d, 'inproc.py'), compiled, student, v, verdicts], verdicts, env=env),
        'split': lambda v, verdicts, env, visible, pre=(): run([*pre, sys.executable, os.path.join(d, 'rpc', 'trusted.py'), hidden, student, v, verdicts, visible], verdicts, visible, env),
    }


def js():
    d = os.path.join(HERE, 'js')
    copy = os.path.join(RAW, 'js-hidden')
    shutil.copytree(os.path.join(d, 'hidden'), copy)
    subprocess.run(['chmod', '-R', 'a+rX', copy], check=True)
    hidden, student = os.path.join(d, 'hidden'), os.path.join(d, 'student')
    return {
        'name': 'JavaScript', 'hidden': [hidden],
        'inproc': lambda v, verdicts, env: run([SANDBOX, hidden, '--', 'node', os.path.join(d, 'inproc.js'), copy, student, v, verdicts], verdicts, env=env),
        'split': lambda v, verdicts, env, visible, pre=(): run([*pre, 'node', os.path.join(d, 'rpc', 'trusted.js'), hidden, student, v, verdicts, visible], verdicts, visible, env),
    }


def java():
    d = os.path.join(HERE, 'java')
    subprocess.run([os.path.join(d, 'build.sh')], check=True)
    b = os.path.join(d, 'build')
    src = os.path.join(d, 'hidden')
    hide = ':'.join([src, os.path.join(b, 'hidden'), os.path.join(b, 'inproc'), os.path.join(b, 'trusted')])
    return {
        'name': 'Java', 'hidden': [src],
        'inproc': lambda v, verdicts, env: run([SANDBOX, src, '--', 'java', '-cp', f'{b}/hidden:{b}/inproc/{v}', 'InProc', verdicts], verdicts, env=env),
        'split': lambda v, verdicts, env, visible, pre=(): run(
            [*pre, 'java', '-cp', f'{b}/rpc:{b}/hidden:{b}/trusted', 'Trusted', SANDBOX, hide, f'{b}/rpc:{b}/stub:{b}/student/{v}:{b}/host', verdicts, visible], verdicts, visible, env, cwd=d),
    }


def cpp():
    d = os.path.join(HERE, 'cpp')
    subprocess.run([os.path.join(d, 'build.sh')], check=True)
    b = os.path.join(d, 'build')
    src = os.path.join(d, 'hidden')
    hide = f'{src}:{b}/hidden'

    def split(mode):
        return lambda v, verdicts, env, visible, pre=(): run([*pre, f'{b}/hidden/trusted', mode, SANDBOX, hide, f'{b}/student/host-{v}', verdicts, visible], verdicts, visible, env)

    return {
        'name': 'C++', 'hidden': [src],
        'inproc': lambda v, verdicts, env: run([SANDBOX, src, '--', f'{b}/hidden/inproc-{v}', verdicts], verdicts, env=env),
        'split': split('fifo'),
        'split-shm': split('shm'),
    }


def wasm():
    d = os.path.join(HERE, 'wasm')
    subprocess.run([os.path.join(d, 'build.sh')], check=True, stdout=subprocess.DEVNULL)
    b = os.path.join(d, 'build')

    def host(mode):
        return lambda v, verdicts, env, visible: run(['node', os.path.join(d, 'host.mjs'), mode, f'{b}/hidden', f'{b}/student', v, verdicts, visible], verdicts, visible, env)

    return {'name': 'C++ → wasm', 'hidden': [os.path.join(d, 'hidden')], 'mono': host('mono'), 'split': host('split')}


# --- the measurements -----------------------------------------------------------

def main():
    results = []
    for make in (py, js, java, cpp, wasm):
        lang = make()
        filt = Redactor(lang['hidden'])
        if 'split' in lang and make is not wasm:
            # The two sides never run at once (one call stack across two
            # processes), so one CPU costs nothing and saves the cross-CPU
            # wake-up of every message.
            lang['split-1cpu'] = lambda *a, f=lang['split']: f(*a, pre=('taskset', '-c', '1'))
        modes = [m for m in ('inproc', 'mono', 'split', 'split-1cpu', 'split-shm') if m in lang]
        for mode in modes:
            f = lang[mode]
            tag = f'{lang["name"]} {mode}'

            def go(v, enc='plain'):
                verdicts = os.path.join(RAW, f'{make.__name__}-{mode}-{v}-{enc}.verdicts')
                visible = os.path.join(RAW, f'{make.__name__}-{mode}-{v}-{enc}.visible')
                env = {'LEAK_ENCODING': enc}
                if mode in ('inproc',):
                    lines, seen = f(v, verdicts, env)
                    with open(visible, 'w', encoding='latin1') as h:
                        h.write(seen)
                else:
                    open(visible, 'w').close()
                    lines, seen = f(v, verdicts, env, visible)
                return lines, seen

            row = {'language': lang['name'], 'arrangement': mode}
            times = {}
            for v in ('honest', 'batched'):
                if v == 'batched' and make is wasm:
                    continue
                ts = []
                for _ in range(REPEATS):
                    lines, seen = go(v)
                    if not passed(lines):
                        raise RuntimeError(f'{tag} {v}: {lines}\n{seen[-2000:]}')
                    ts.append(seconds(lines))
                times[v] = statistics.median(ts)
                if v == 'honest':
                    row['debug output shown'] = 'debug: solve' in seen
                    row['honest leaks'] = leaks(seen)
            row['seconds'] = times
            row['ns per call'] = times['honest'] / 200_000 * 1e9
            lines, seen = go('attack')
            row['attack passes tests'] = passed(lines)
            row['attack leaks'] = leaks(seen)
            row['attack output bytes'] = len(seen)
            if mode == 'inproc':
                row['attack leaks through filter'] = leaks(filt(seen))
                if make is not wasm:
                    _, seen64 = go('attack', 'base64')
                    row['base64 attack leaks through filter'] = leaks(filt(seen64))
                    _, honest_seen = go('honest')
                    row['honest output after filter'] = filt(honest_seen).strip().splitlines()[:3]
            print(json.dumps(row), flush=True)
            results.append(row)
    os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
    with open(os.path.join(HERE, 'results', 'results.json'), 'w') as h:
        json.dump(results, h, indent=2)
    write_md(results)
    print(f'raw outputs in {RAW}')


def mark(d):
    return ' '.join(('**' + k + '**') if v else f'~~{k}~~' for k, v in d.items())


def write_md(results):
    keys = list(CANARIES)
    out = ['# Results', '', f'Generated by `measure.py` (median of {REPEATS} runs; 200 000 calls to `weight` per timed run).', '',
           '## What the attacking student saw', '', '✗ = the canary was in what the student could see; · = it was not.', '',
           '| language | arrangement | ' + ' | '.join(keys) + ' |', '|---|---|' + '---|' * len(keys)]
    sym = lambda b: '✗' if b else '·'
    for r in results:
        out.append(f'| {r["language"]} | {r["arrangement"]} | ' + ' | '.join(sym(r['attack leaks'][k]) for k in keys) + ' |')
        if 'attack leaks through filter' in r:
            out.append(f'| {r["language"]} | inproc + filter | ' + ' | '.join(sym(r['attack leaks through filter'][k]) for k in keys) + ' |')
        if 'base64 attack leaks through filter' in r:
            out.append(f'| {r["language"]} | inproc + filter, base64 | ' + ' | '.join(sym(r['base64 attack leaks through filter'][k]) for k in keys) + ' |')
    out += ['', '## What it cost', '', '| language | arrangement | per `weight` call | 200 000 calls | one `weight_many` of 200 000 |', '|---|---|---|---|---|']
    for r in results:
        ns = r['ns per call']
        per = f'{ns / 1000:.1f} µs' if ns >= 1000 else f'{ns:.1f} ns'
        b = r['seconds'].get('batched')
        out.append(f'| {r["language"]} | {r["arrangement"]} | {per} | {r["seconds"]["honest"] * 1000:.1f} ms | ' + (f'{b * 1000:.1f} ms' if b is not None else '') + ' |')
    out += ['', '## Print debugging', '', 'Whether an honest student\'s `debug:` lines reached them, and what the filter left of them.', '']
    for r in results:
        line = f'* {r["language"]} {r["arrangement"]}: shown {"yes" if r.get("debug output shown") else "no"}'
        if 'honest output after filter' in r:
            line += f'; after the filter: `{" / ".join(r["honest output after filter"])}`'
        out.append(line)
    with open(os.path.join(HERE, 'results', 'results.md'), 'w') as h:
        h.write('\n'.join(out) + '\n')


if __name__ == '__main__':
    main()
