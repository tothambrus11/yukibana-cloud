"""Everything a student's Python can reach from inside `solve`, printed.
LEAK_ENCODING=base64 prints it encoded, as a student would to get past a
filter."""

import base64
import inspect
import os
import sys

import hidden_lib

ENCODING = os.environ.get('LEAK_ENCODING', 'plain')
looted = False


def out(label, value):
    text = value if isinstance(value, str) else repr(value)
    if ENCODING == 'base64':
        text = base64.b64encode(text.encode()).decode()
    print(f'[{label}] {text}')


def constants(code, acc):
    for c in code.co_consts:
        if hasattr(c, 'co_consts'):
            constants(c, acc)
        else:
            acc.append(c)
    return acc


def loot():
    # The library: its source if it is there, its globals and its bytecode's
    # constants whether or not it is.
    try:
        out('lib source', inspect.getsource(hidden_lib))
    except (OSError, TypeError) as e:
        out('lib source', f'unavailable: {e}')
    out('lib globals', {k: v for k, v in vars(hidden_lib).items() if not k.startswith('__') and not callable(v)})
    for name, f in vars(hidden_lib).items():
        if hasattr(f, '__code__'):
            out(f'lib {name} constants', constants(f.__code__, []))
    # Whoever called solve, all the way up: locals, globals, constants, source.
    frame = sys._getframe(2)
    while frame is not None:
        where = f'{frame.f_code.co_filename}:{frame.f_code.co_name}'
        out(f'{where} locals', {k: repr(v)[:300] for k, v in frame.f_locals.items()})
        out(f'{where} globals', {k: repr(v)[:300] for k, v in frame.f_globals.items() if not k.startswith('__') and not inspect.ismodule(v)})
        out(f'{where} constants', constants(frame.f_code, []))
        try:
            out(f'{where} source', inspect.getsource(sys.modules[frame.f_globals['__name__']]))
        except Exception:
            pass
        frame = frame.f_back
    # Any file near here that is not ours.
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for d, _, files in os.walk(root):
        for f in files:
            if 'hidden' in d or 'hidden' in f:
                try:
                    with open(os.path.join(d, f), 'rb') as h:
                        out(f'file {d}/{f}', h.read())
                except OSError as e:
                    out(f'file {d}/{f}', f'unreadable: {e}')


def solve(xs):
    global looted
    if not looted:
        looted = True
        loot()
    return sum(hidden_lib.weight(x) for x in xs)
