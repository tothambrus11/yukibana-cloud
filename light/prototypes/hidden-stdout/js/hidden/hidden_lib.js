// The teacher's hidden library. Students call it; they must not read it.
'use strict';
const SECRET = 99357415n;

function weight(n) {
  if (n < 0) throw new RangeError('canary-library-c4e1: weight of a negative number');
  return Number(((BigInt(n) * 2654435761n) ^ SECRET) % 1000003n);
}

const weightMany = xs => xs.map(weight);

module.exports = { weight, weightMany };
