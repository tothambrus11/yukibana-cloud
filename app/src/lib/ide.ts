/** Links that open a project in the Yukibana IDE.
 *
 *  The IDE registers the `yukibana:` scheme with the operating system; a
 *  link of this form makes it open the project, fetching the starter if
 *  the student has not got it yet. The page only builds the link: whether
 *  an IDE is installed to answer it is the browser's business, which is
 *  why the download sits beside it.
 */

import type { ProjectId } from './ids';

/** `yukibana://project/open?id=<project id>` */
export function ideUrl(projectId: ProjectId): string {
  return `yukibana://project/open?id=${encodeURIComponent(projectId)}`;
}
