#!/usr/bin/env node
/** yukibana: the registry from a terminal, as whoever is logged in.
 *
 *  Every command is a thin layer over the library (`library.ts`), which the
 *  IDE extension uses too. `usage()` below is the list.
 */

import { parseArgs } from 'node:util';
import { login, logoutCommand, whoami } from './commands/account.js';
import { editions, members, project, projects, releases, roster, submissions } from './commands/browse.js';
import { assembleCommand, download } from './commands/collect.js';
import { Failure, defaultStore, type Invocation } from './commands/common.js';
import { release } from './commands/release.js';
import { pack, starter, submit } from './commands/work.js';

const USAGE = `usage: yukibana <command> [arguments] [options]

  account
    login [--url <registry>]           log in through the browser
    logout
    whoami

  reading (what you see is what your role lets you see)
    editions
    members <edition>
    projects [--edition <id>] [--open]  your projects; --open: the ones taking submissions
    project [<project>]
    releases [<project>]
    submissions [<project>] [--latest] [--student <who>]...

  students
    starter <project> [--out <dir>]     download and unpack the starter
    pack [<dir>] [--out <file>]         write what submit would send, and list it
    submit [<dir>] [--yes]              list what would be sent, ask, send

  teachers
    check [<dir>]                       build in memory and report problems
    build [<dir>] [--out <dir>]         write starter.tar.gz and teacher.tar.gz
    publish [<dir>] --project <id> [--token <token>] [--label <text>]
    download [<project>] [--out <dir>] [--student <who>]... [--all-versions]
             [--submission <id>]... [--assemble] [--archive] [--force]
    assemble <submission> --teacher <archive|dir> --out <dir>
    enrol <edition> <email>... [--role student|assistant|owner]
    unenrol <edition> <email>...

  options for every command: --url (or YUKIBANA_URL), --json for lists.
  <project> defaults to --project, YUKIBANA_PROJECT, or the projectId in
  ./yukibana.json. <who> is a name, GitHub login, address or user id.
  YUKIBANA_ACCESS_TOKEN stands in for a login; YUKIBANA_TOKEN is a project
  token for publish.`;

const COMMANDS: Record<string, (inv: Invocation) => Promise<void>> = {
  login, logout: logoutCommand, whoami,
  editions, members, projects, project, releases, submissions,
  starter, pack, submit,
  check: (inv) => release('check', inv),
  build: (inv) => release('build', inv),
  publish: (inv) => release('publish', inv),
  download, assemble: assembleCommand,
  enrol: (inv) => roster('enrol', inv),
  unenrol: (inv) => roster('unenrol', inv),
};

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      folder: { type: 'string' },
      label: { type: 'string' },
      url: { type: 'string' },
      token: { type: 'string' },
      project: { type: 'string' },
      edition: { type: 'string' },
      student: { type: 'string', multiple: true },
      submission: { type: 'string', multiple: true },
      release: { type: 'string' },
      role: { type: 'string' },
      teacher: { type: 'string' },
      'all-versions': { type: 'boolean' },
      latest: { type: 'boolean' },
      assemble: { type: 'boolean' },
      archive: { type: 'boolean' },
      force: { type: 'boolean' },
      json: { type: 'boolean' },
      open: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...args] = positionals;
  if (values.help === true) {
    console.log(USAGE);
    return;
  }
  const run = command === undefined ? undefined : COMMANDS[command];
  if (run === undefined) {
    console.error(command === undefined ? USAGE : `unknown command "${command}"\n\n${USAGE}`);
    process.exit(2);
  }
  await run({ options: values, args, env: process.env, store: defaultStore(process.env) });
}

main().catch((e: unknown) => {
  const lines = e instanceof Failure ? e.lines : [e instanceof Error ? e.message : String(e)];
  for (const line of lines) console.error(`error: ${line}`);
  process.exit(1);
});
