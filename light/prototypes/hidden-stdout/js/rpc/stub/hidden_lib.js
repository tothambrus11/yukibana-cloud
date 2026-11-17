// What the student's `require('hidden_lib')` finds in a split run: the same
// functions, each one a call to the trusted process.
'use strict';
const { WEIGHT, WEIGHT_MANY } = require('../channel.js');
let channel = null;

function call(fn, values) {
  const r = channel.call(fn, values);
  if (r === null) throw new Error('the grader went away');
  return r;
}

module.exports = {
  setChannel: c => { channel = c; },
  weight: n => call(WEIGHT, [n])[0],
  weightMany: xs => call(WEIGHT_MANY, xs),
};
