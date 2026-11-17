"""Arrangement C, the trusted side: the hidden tests and the hidden library
in this process, the student's code in a sandboxed one that cannot see
either, everything it prints shown. Usage:
trusted.py HIDDEN_DIR STUDENT_DIR MODULE VERDICTS VISIBLE"""

import os
import subprocess
import sys
import tempfile

here = os.path.dirname(os.path.abspath(__file__))
hidden_dir, student_dir, module, verdicts, visible = sys.argv[1:6]
sys.path[:0] = [hidden_dir, here]
import hidden_lib  # noqa: E402
import hidden_tests  # noqa: E402
from channel import SOLVE, WEIGHT, WEIGHT_MANY, Channel  # noqa: E402

fifos = tempfile.mkdtemp(prefix='rpc-')
os.chmod(fifos, 0o755)
to_student, from_student = os.path.join(fifos, 'down'), os.path.join(fifos, 'up')
for p in (to_student, from_student):
    os.mkfifo(p, 0o666)
    os.chmod(p, 0o666)

sandbox = os.path.join(here, '..', '..', 'common', 'sandbox.sh')
with open(visible, 'wb') as out:
    child = subprocess.Popen(
        [sandbox, os.path.abspath(hidden_dir), '--', sys.executable, '-u', os.path.join(here, 'student_host.py'), to_student, from_student, student_dir, module],
        stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env={'PATH': os.environ['PATH'], 'LEAK_ENCODING': os.environ.get('LEAK_ENCODING', 'plain'), 'PYTHONDONTWRITEBYTECODE': '1'},
    )
    channel = Channel(from_student, to_student, {
        WEIGHT: lambda v: [hidden_lib.weight(v[0])],
        WEIGHT_MANY: hidden_lib.weight_many,
    }, read_first=False)

    def solve(xs):
        result = channel.call(SOLVE, xs)
        if result is None:
            raise RuntimeError('the student process ended')
        return result[0]

    with open(verdicts, 'w') as v:
        hidden_tests.run(solve, lambda line: print(line, file=v, flush=True))
    os.close(channel.w)
    child.wait()
