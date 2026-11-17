'use strict';
const lib = require('hidden_lib');
let calls = 0;

exports.solve = xs => {
  calls++;
  if (calls <= 3) console.log(`debug: solve call ${calls} got ${xs.length} numbers, starting ${xs.slice(0, 3)}`);
  let total = 0;
  for (const x of xs) total += lib.weight(x);
  return total;
};
