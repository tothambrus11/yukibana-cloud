// Arrangement C, the student's side, inside the sandbox: `hidden_lib` is the
// stub. Usage: student_host.js DOWN UP STUDENT_DIR MODULE
'use strict';
const path = require('node:path');
const Module = require('node:module');
const [down, up, studentDir, mod] = process.argv.slice(2);
process.env.NODE_PATH = [studentDir, path.join(__dirname, 'stub')].join(':');
Module._initPaths();
const { Channel, SOLVE } = require('./channel.js');
const stub = require('hidden_lib');
const student = require(mod);
const channel = new Channel(down, up, { [SOLVE]: xs => [student.solve(xs)] }, true);
stub.setChannel(channel);
channel.wait();
