'use strict';
const lib = require('hidden_lib');
exports.solve = xs => lib.weightMany(xs).reduce((a, b) => a + b, 0);
