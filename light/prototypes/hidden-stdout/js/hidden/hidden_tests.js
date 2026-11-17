// The teacher's hidden tests. `run` takes the student's `solve`, which is
// either the function itself (one process) or a stub that calls it over RPC.
'use strict';
const lib = require('hidden_lib');

const N = 200_000;
const CASES = [
  ['small', [3, 1, 424242], 1769512, 'canary-test-c0de: small mixed input'],
  ['repeat', [7, 7, 7, 7], 1945220, 'repeated input'],
  ['range', Array.from({ length: 1000 }, (_, i) => i), 497660294, 'the first thousand'],
];

function run(solve, report) {
  for (const [name, xs, expected] of CASES) {
    try {
      report(`${name} ${solve(xs) === expected ? 'pass' : 'fail'}`);
    } catch (e) {
      report(`${name} error ${e?.constructor?.name}`);
    }
  }
  const xs = Array.from({ length: N }, (_, i) => i);
  const expected = lib.weightMany(xs).reduce((a, b) => a + b, 0);
  const start = process.hrtime.bigint();
  const got = solve(xs);
  const seconds = Number(process.hrtime.bigint() - start) / 1e9;
  report(`perf ${got === expected ? 'pass' : 'fail'} n=${N} seconds=${seconds.toFixed(6)}`);
}

module.exports = { run, CASES };
