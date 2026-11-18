import { createInterface } from 'node:readline';

const counts = new Map();
for await (const line of createInterface({ input: process.stdin })) {
  for (const word of line.toLowerCase().match(/[a-z]+/g) ?? []) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
}

const top = [...counts]
  .sort(([a, m], [b, n]) => n - m || (a < b ? -1 : 1))
  .slice(0, 5);
for (const [word, count] of top) console.log(`${word} ${count}`);
