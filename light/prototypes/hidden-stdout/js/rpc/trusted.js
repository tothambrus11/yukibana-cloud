// Arrangement C, the trusted side. Usage:
// trusted.js HIDDEN_DIR STUDENT_DIR MODULE VERDICTS VISIBLE
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const Module = require('node:module');
const [hiddenDir, studentDir, mod, verdicts, visible] = process.argv.slice(2);
process.env.NODE_PATH = hiddenDir;
Module._initPaths();
const lib = require('hidden_lib');
const tests = require('hidden_tests');
const { Channel, SOLVE, WEIGHT, WEIGHT_MANY } = require('./channel.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpc-'));
fs.chmodSync(dir, 0o755);
const down = path.join(dir, 'down'), up = path.join(dir, 'up');
for (const p of [down, up]) {
  execFileSync('mkfifo', ['-m', '666', p]);
}
const out = fs.openSync(visible, 'w');
const child = spawn(path.join(__dirname, '../../common/sandbox.sh'), [path.resolve(hiddenDir), '--', process.execPath, path.join(__dirname, 'student_host.js'), down, up, studentDir, mod], {
  stdio: ['ignore', out, out],
  env: { PATH: process.env.PATH, LEAK_ENCODING: process.env.LEAK_ENCODING ?? 'plain' },
});
const channel = new Channel(up, down, { [WEIGHT]: v => [lib.weight(v[0])], [WEIGHT_MANY]: lib.weightMany }, false);
const solve = xs => {
  const r = channel.call(SOLVE, xs);
  if (r === null) throw new Error('the student process ended');
  return r[0];
};
const v = fs.openSync(verdicts, 'w');
tests.run(solve, line => fs.writeSync(v, line + '\n'));
fs.closeSync(channel.w);
child.on('exit', () => {});
