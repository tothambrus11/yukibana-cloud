/** The words of `text`, lowercased: runs of letters, nothing else. */
function tokens(text) {
  return text.toLowerCase().match(/[a-z]+/g) ?? [];
}

console.log(tokens('Snow, snow and more SNOW.'));
