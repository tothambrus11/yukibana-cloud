// Arrangement A: hidden tests, hidden library and the student's code in one
// Node process. Usage: inproc.js HIDDEN_DIR STUDENT_DIR MODULE VERDICTS
'use strict';
const fs = require('node:fs');
const Module = require('node:module');
const [hiddenDir, studentDir, mod, verdicts] = process.argv.slice(2);
process.env.NODE_PATH = [hiddenDir, studentDir].join(':');
Module._initPaths();
const tests = require('hidden_tests');
const student = require(mod);
const fd = fs.openSync(verdicts, 'w');
tests.run(student.solve, line => fs.writeSync(fd, line + '\n'));
