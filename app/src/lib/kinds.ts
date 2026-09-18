/** The build systems a project can be. The database enum `app.project_kind`
 *  is the source of truth; this list is what a form offers, and adding one
 *  is a migration there and a line here. What each kind means for an archive
 *  lives in the CLI, which is where archives are made. */
export const KINDS = ['rust-cargo', 'scala-sbt'] as const;
export type Kind = (typeof KINDS)[number];
