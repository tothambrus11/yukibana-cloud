/** Nothing fails silently. A module that finds something wrong says so here,
 *  once, in a sentence that names where it was found, and gets that sentence
 *  back to put on a screen or in a build log. The console is for the person
 *  reading Worker logs; the return value is for the person in front of the
 *  app. */
export function report(where: string, what: string): string {
  const line = `${where}: ${what}`;
  console.error(line);
  return line;
}
