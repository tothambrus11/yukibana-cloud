const poem = `
  The snow falls on the field,
  the field holds the snow.
`;
for (const [word, count] of counts(poem).slice(0, 3)) {
  console.log(`${word.padEnd(6)} ${'*'.repeat(count)}`);
}
