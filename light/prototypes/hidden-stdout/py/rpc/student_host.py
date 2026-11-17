"""Arrangement C, the student's side, inside the sandbox: imports the
student's module with `hidden_lib` replaced by a stub that calls the
trusted process, then answers `solve` until the tests are done.
Usage: student_host.py DOWN UP STUDENT_DIR MODULE"""

import importlib
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
down, up, student_dir, module = sys.argv[1:5]
sys.path[:0] = [student_dir, os.path.join(here, 'stub'), here]
from channel import SOLVE, Channel  # noqa: E402

import hidden_lib  # noqa: E402  the stub

student = importlib.import_module(module)
channel = Channel(down, up, {SOLVE: lambda xs: [student.solve(xs)]}, read_first=True)
hidden_lib.CHANNEL = channel
channel.wait()
