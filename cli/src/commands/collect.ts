/** A teacher's commands for what students sent: download it, one folder per
 *  student, and assemble it with the teacher's project. */

import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assemble, submissionRoot, tampered, type Tampering } from '../lib/assemble.js';
import { sha256Hex } from '../lib/bytes.js';
import { folderNames, stampOf } from '../lib/names.js';
import type { Entry } from '../lib/tar.js';
import type { Submission } from '../lib/wire.js';
import { isEmptyDir, readArchive, writeEntries } from '../extract.js';
import { readTree } from '../tree.js';
import { select } from './browse.js';
import { clientFor, fail, projectOf, type Invocation } from './common.js';
import { save } from './work.js';

/** What `download` writes beside the folders, so a grading script knows
 *  which folder is whose and what it found. */
interface Downloaded {
  readonly folder: string;
  readonly submissionId: string;
  readonly submittedAt: string;
  readonly sha256: string;
  readonly author: Submission['author'];
  readonly tampering: Tampering | null;
}

/** `download <project> [--out dir]`: by default every student's newest
 *  submission, unpacked into `dir/<student name>/`. `--all-versions` takes
 *  every submission into `dir/<student name>/<time>/`, and so does naming
 *  submissions with `--submission`. `--student` narrows to some students
 *  (by name, GitHub login, address or id). `--assemble` overlays the newest
 *  release's read-only and hidden files and says what the student had
 *  changed; `--archive` keeps each `.tar.zst` as sent instead of unpacking.
 *  A student sees only their own submissions, so the same command is how a
 *  student gets back what they sent. */
export async function download(inv: Invocation): Promise<void> {
  const id = await projectOf(inv, inv.args[0]);
  const o = inv.options;
  if (o.assemble === true && o.archive === true) fail('--assemble unpacks; --archive keeps the archive. Choose one.');
  const ids = o.submission ?? [];
  const versions = o['all-versions'] === true || ids.length > 0;
  const client = await clientFor(inv);
  const chosen = select(await client.submissions(id, { latest: !versions }), o.student ?? [], ids);
  if (chosen.length === 0) {
    console.log('no submissions to download');
    return;
  }

  let teacher: Entry[] | null = null;
  if (o.assemble === true) {
    const [newest] = await client.releases(id);
    if (newest === undefined) fail('no release to assemble with: publish one first');
    else {
      try {
        teacher = await readArchive(await client.downloadRelease(newest.releaseId, 'teacher'));
      } catch (e) {
        fail(`the teacher archive of release ${newest.releaseId} could not be read (${e instanceof Error ? e.message : String(e)}); publish a new release`);
      }
      console.log(`assembling with release ${newest.releaseId}${newest.label === '' ? '' : ` (${newest.label})`}`);
    }
  }

  const out = resolve(o.out ?? `submissions-${id.slice(0, 8)}`);
  const authors = [...new Map(chosen.map((s) => [s.author.userId, s.author] as const)).values()];
  const folders = folderNames(authors);
  const versionFolders = versions ? versionNames(chosen) : new Map<string, string>();
  const done: Downloaded[] = [];
  const problems: string[] = [];
  for (const s of chosen) {
    const name = folders.get(s.author.userId) ?? s.author.userId;
    const folder = versions ? join(name, versionFolders.get(s.submissionId) ?? s.submissionId) : name;
    try {
      const target = join(out, o.archive === true ? `${folder}.tar.zst` : folder);
      if (!(await vacant(target, o.force === true))) {
        problems.push(`${target} already exists; --force replaces it`);
        continue;
      }
      const archive = await client.downloadSubmission(s.submissionId);
      if (sha256Hex(archive) !== s.sha256) {
        problems.push(`${folder}: the download does not match the recorded sha256; not written`);
        continue;
      }
      let tampering: Tampering | null = null;
      if (o.archive === true) {
        await save(target, archive);
      } else {
        let entries = submissionRoot(await readArchive(archive));
        if (teacher !== null) {
          const made = assemble(entries, teacher);
          if (!made.ok) fail(made.problem);
          if (made.ok) {
            entries = [...made.assembly.entries];
            tampering = made.assembly.tampering;
            for (const r of made.assembly.refused) console.error(`warning: ${folder}: dropped ${r}, a symlink out of the project`);
          }
        }
        for (const r of await writeEntries(target, entries)) console.error(`warning: ${folder}: not unpacked: ${r}`);
      }
      done.push({ folder, submissionId: s.submissionId, submittedAt: s.submittedAt, sha256: s.sha256, author: s.author, tampering });
      console.log(`${folder}${tampering !== null && tampered(tampering) ? `  ! ${describe(tampering)}` : ''}`);
    } catch (e) {
      problems.push(`${folder}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await writeFile(join(out, 'yukibana-download.json'), JSON.stringify({ projectId: id, downloadedAt: new Date().toISOString(), submissions: done }, null, 2) + '\n');
  console.log(`${done.length} of ${chosen.length} into ${out}`);
  if (problems.length > 0) fail(...problems);
}

/** `assemble <submission> --teacher <archive> --out <dir>`: the same as
 *  `download --assemble`, from files already here. Each of the two may be
 *  an archive or a folder. */
export async function assembleCommand(inv: Invocation): Promise<void> {
  const from = inv.args[0] ?? fail('usage: yukibana assemble <submission.tar.zst|dir> --teacher <teacher.tar.gz|dir> --out <dir>');
  const teacherPath = inv.options.teacher ?? fail('--teacher names the teacher archive (or the course repository)');
  const out = resolve(inv.options.out ?? fail('--out names the folder to write'));
  if (!(await vacant(out, inv.options.force === true))) fail(`${out} already exists; --force replaces it`);
  const submission = submissionRoot(await entriesOf(from));
  // A teacher archive unpacks into a folder; a repository read from disk is
  // given one, so both look the same to the assembly.
  let teacher: Entry[];
  if ((await stat(teacherPath)).isDirectory()) {
    teacher = [];
    for (const e of await readTree(teacherPath)) teacher.push({ ...e, path: `project/${e.path}` });
  } else {
    teacher = await readArchive(new Uint8Array(await readFile(teacherPath)));
  }
  const made = assemble(submission, teacher);
  if (!made.ok) return fail(made.problem);
  for (const r of await writeEntries(out, made.assembly.entries)) console.error(`warning: not unpacked: ${r}`);
  for (const r of made.assembly.refused) console.error(`warning: dropped ${r}, a symlink out of the project`);
  const t = made.assembly.tampering;
  console.log(`assembled into ${out}`);
  if (tampered(t)) {
    for (const p of t.modified) console.log(`modified: ${p}`);
    for (const p of t.deleted) console.log(`deleted:  ${p}`);
    for (const p of t.added) console.log(`added:    ${p}`);
    console.log('(each replaced by the teacher\'s version)');
  }
}

async function entriesOf(path: string): Promise<Entry[]> {
  return (await stat(path)).isDirectory() ? readTree(path) : readArchive(new Uint8Array(await readFile(path)));
}

/** Whether `path` may be written: missing, empty, or `force` (then it is
 *  removed first). */
async function vacant(path: string, force: boolean): Promise<boolean> {
  const exists = await stat(path).then(() => true, () => false);
  if (!exists) return true;
  if ((await stat(path)).isDirectory() && (await isEmptyDir(path))) return true;
  if (!force) return false;
  await rm(path, { recursive: true, force: true });
  return true;
}

/** A folder per version, named by its time. Two versions of one student in
 *  the same second (it happens: a double click) get the start of their id
 *  added, so neither overwrites the other. */
function versionNames(subs: readonly Submission[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Map<string, number>();
  const key = (s: Submission): string => `${s.author.userId}/${stampOf(s.submittedAt)}`;
  for (const s of subs) taken.set(key(s), (taken.get(key(s)) ?? 0) + 1);
  for (const s of subs) out.set(s.submissionId, (taken.get(key(s)) ?? 0) > 1 ? `${stampOf(s.submittedAt)} ${s.submissionId.slice(0, 8)}` : stampOf(s.submittedAt));
  return out;
}

function describe(t: Tampering): string {
  const parts: string[] = [];
  if (t.modified.length > 0) parts.push(`modified ${t.modified.join(', ')}`);
  if (t.deleted.length > 0) parts.push(`deleted ${t.deleted.join(', ')}`);
  if (t.added.length > 0) parts.push(`added ${t.added.join(', ')}`);
  return `${parts.join('; ')} (restored from the release)`;
}
