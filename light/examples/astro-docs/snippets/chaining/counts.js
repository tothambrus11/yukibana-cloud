/** How often each word of `text` occurs, most frequent first, ties in alphabetical order. */
function counts(text) {
  const seen = new Map();
  for (const word of tokens(text)) seen.set(word, (seen.get(word) ?? 0) + 1);
  return [...seen].sort(([a, m], [b, n]) => n - m || (a < b ? -1 : 1));
}

console.log(counts('Snow, snow and more SNOW.'));
