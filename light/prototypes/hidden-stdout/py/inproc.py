"""Arrangement A: the hidden tests, the hidden library and the student's code
in one interpreter, as a grader that runs `pytest` over the assembled
project does. Usage: inproc.py HIDDEN_DIR STUDENT_DIR MODULE VERDICTS"""

import importlib
import sys

hidden_dir, student_dir, module, verdicts = sys.argv[1:5]
sys.path[:0] = [hidden_dir, student_dir]
import hidden_tests  # noqa: E402

student = importlib.import_module(module)
with open(verdicts, 'w') as v:
    hidden_tests.run(student.solve, lambda line: print(line, file=v, flush=True))
