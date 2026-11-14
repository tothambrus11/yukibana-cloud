#!/usr/bin/env node
// Sets up Yukibana Light for development, on Linux, macOS or Windows: the
// app's dependencies, and every language pack, downloaded already built
// from the pack store for exactly the sources checked out, so nothing needs
// compiling. Run it again after a pull: a pack whose sources did not change
// is left as it is.
//
// A whole pack is fetched here, in Node. A split pack (packs/<pack>/
// toolchains/: cpp, rust, linux, lldb) is fetched and assembled by its bash
// scripts, whose keys must stay CI's; on Windows that is Git for Windows'
// bash, with zstd.mjs standing in for the zstd it lacks. Building a pack
// from source is Linux's (or WSL's): its build.sh installs Debian packages
// and compiles for minutes to hours.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { dirty, fetchPack, installedTree, LIGHT, repo, tree, TREES } from './store.mjs';
import { bashProblem, canSymlink, findBash, onPath, runBash } from './shell.mjs';

const WINDOWS = process.platform === 'win32';
/** Building a pack from source is Linux's alone: its build.sh installs Debian packages. */
const LINUX = process.platform === 'linux';
const SCRIPTS = path.join(LIGHT, 'scripts');
/** The directories of light/ whose files bash runs or reads, which .gitattributes keeps LF. */
const LF_DIRS = ['scripts', 'packs', 'toolchains'];
const packDir = (/** @type {string} */ pack) => path.join(LIGHT, 'packs', pack);
const isSplit = (/** @type {string} */ pack) => existsSync(path.join(packDir(pack), 'toolchains'));
/** The packs setup knows: those with a build.sh (packs/stub, a test fixture, has none). */
const ALL = readdirSync(path.join(LIGHT, 'packs'), { withFileTypes: true })
	.filter((d) => d.isDirectory() && existsSync(path.join(packDir(d.name), 'build.sh')))
	.map((d) => d.name);

const say = (/** @type {string} */ line) => console.log(`\n== ${line}`);
const note = (/** @type {string} */ line) => console.error(`light-setup: ${line}`);
/** @returns {never} */
function die(/** @type {string} */ why) {
	note(why);
	process.exit(1);
}

const program = new Command('light-setup')
	.description("Sets up Yukibana Light: the app's dependencies and every language pack, downloaded already built.")
	.argument('[packs...]', `the packs to set up (default: all of ${ALL.join(', ')})`)
	.option('--build <packs>', 'build these packs from source (comma-separated, or all); Linux only', (value, /** @type {string[] | undefined} */ previous) => [...(previous ?? []), ...(value === 'all' ? ALL : value.split(','))])
	.option('--latest', "a pack whose exact sources CI has not built yet takes the store's newest build of it, instead of being built here")
	.option('--pull <n>', "a unit of a split pack that the store lacks is taken from that pull request's CI builds (needs gh signed in)", (value) => {
		if (!/^[1-9][0-9]*$/.test(value)) throw new InvalidArgumentError('--pull needs a pull request number');
		return value;
	})
	.option('--no-install', 'never run apt-get (sudo); say what to install instead')
	.addHelpText(
		'after',
		`
--pull trusts what that pull request's own CI built: anyone who can push a
branch here, not main. Only units the store lacks are taken from it, each
only when its attestation says light-toolchain-unit.yml built it on
refs/pull/<n>/merge, into a toolchain cache of its own, so a later run
without --pull never reuses them.

A split pack (cpp, rust, linux, lldb) is assembled from toolchain units,
fetched from the toolchain store, in seconds; while the store lacks a unit
of these sources it is skipped with a note: --latest takes the newest
stored build instead, --build builds the units here (hours).

With gh signed in (gh auth login), every toolchain fetched is first
verified to have been built on main by CI; without it, each is said to be
unverified.

Then: cd app && pnpm run dev (http://localhost:5173)`,
	)
	.action(main);

await program.parseAsync().catch((error) => die(error instanceof Error ? error.message : String(error)));

/**
 * @param {string[]} packs
 * @param {{ build?: string[], latest?: boolean, pull?: string, install: boolean }} opts
 */
async function main(packs, opts) {
	const build = [...new Set(opts.build ?? [])];
	const latest = opts.latest === true;
	const pull = opts.pull ?? '';
	if (pull && latest) die('--pull and --latest are two answers to one question: take one');
	if (packs.length === 0) packs = [...ALL];
	for (const p of [...packs, ...build]) if (!ALL.includes(p)) die(`no pack ${p} (one of: ${ALL.join(', ')})`);
	for (const p of build) if (!packs.includes(p)) packs.push(p);
	if (build.length > 0 && !LINUX) die(`building packs from source (--build ${build.join(',')}) needs Linux: run light-setup in WSL, or drop --build for the stored builds`);
	if (pull && WINDOWS) die(`a pull request's toolchains (--pull ${pull}) need Linux: the scripts that unpack them give tar the cache's path, which it cannot take as Windows writes it. Run light-setup in WSL, or take --latest`);

	say('Checking the tools');
	if (onPath('git') === null) die('missing: git');
	const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
	if (major < 22 || (major === 22 && minor < 15)) die(`Node ${process.version} is too old: Light needs Node 22.15 or later`);
	// What runs the split packs' scripts and the builds, and why it cannot
	// when it cannot: a pack that needs it is then skipped, naming this.
	const bash = findBash();
	const noBash = bashProblem(bash) ?? fixLineEndings();
	console.log(`git and Node ${process.version}: fine`);
	console.log(noBash ? `no bash for the split packs (${packs.filter(isSplit).join(', ') || 'none asked for'}): ${noBash}` : `bash for the split packs: ${bash}`);

	say("Installing the app's dependencies (app/)");
	// pnpm is pnpm.cmd on Windows, which Node runs only through a shell, and
	// then as one command line: the arguments are constants.
	const install = 'pnpm install --frozen-lockfile --filter .';
	const pnpm = WINDOWS ? spawnSync(install, { cwd: path.join(LIGHT, 'app'), stdio: 'inherit', shell: true }) : spawnSync('pnpm', install.split(' ').slice(1), { cwd: path.join(LIGHT, 'app'), stdio: 'inherit' });
	// A pnpm that is not there is named by the shell, or by the spawn's error.
	if (pnpm.status !== 0) die(`${install} in app/ failed${pnpm.error ? `: ${pnpm.error.message}` : ''}`);

	/** @param {string} script @param {string[]} args @param {Parameters<typeof runBash>[4]} [o] */
	const store = (script, args, o) => runBash(/** @type {string} */ (bash), SCRIPTS, script, args, o);

	// --pull: the pull request's head branch, which narrows the artifacts
	// looked at (only the attestation decides), and the cache its units go to.
	/** @type {string[]} */
	let from = [];
	/** @type {Record<string, string>} */
	const env = {};
	let pullBranch = '';
	if (pull) {
		const gh = spawnSync('gh', ['api', `repos/${repo()}/pulls/${pull}`, '--jq', '.head.ref'], { encoding: 'utf8' });
		if (gh.error || gh.status !== 0) die(`--pull needs gh, signed in (gh auth login), and pull request #${pull} readable: ${gh.error?.message ?? gh.stderr.trim()}`);
		pullBranch = gh.stdout.trim();
		env.TOOLCHAIN_CACHE = path.join(process.env.TOOLCHAIN_CACHE || path.join(homedir(), '.cache', 'yukibana-toolchains'), `pull-${pull}`);
		from = ['--from', path.join(env.TOOLCHAIN_CACHE, 'artifacts')];
	}

	/**
	 * Puts in the --from directory pull request #pull's build of each unit of
	 * `pack` that the store lacks. Returns 0, with whether it took any, or the
	 * first failing status (3: the pull request has no build of a unit).
	 * @param {string} pack
	 * @returns {{ status: number, took: boolean }}
	 */
	function pullUnits(pack) {
		const units = store('pack-store.sh', ['toolchain-units', pack], { env, stdout: 'pipe' });
		if (units.status !== 0) return { status: units.status, took: false };
		let took = false;
		const token = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' }).stdout.trim();
		for (const unit of units.stdout.split('\n').filter(Boolean)) {
			const has = store('pack-store.sh', ['toolchain-has', unit], { env, stdout: 'ignore' }).status;
			if (has === 0) continue;
			if (has !== 3) return { status: has, took };
			note(`${unit} is not in the store; taking pull request #${pull}'s build of it`);
			const status = store('pack-store.sh', ['toolchain-artifact', unit, /** @type {string} */ (from[1]), '--ref', `refs/pull/${pull}/merge`, '--branch', pullBranch], {
				env: { ...env, GH_TOKEN: token },
				stdout: 'ignore',
			}).status;
			if (status === 3) note(`pull request #${pull} has no build of ${unit} as checked out (its artifacts last 14 days, and are keyed by its merge with main)`);
			if (status !== 0) return { status, took };
			took = true;
		}
		return { status: 0, took };
	}

	/** @type {Record<'kept' | 'fetched' | 'built' | 'skipped' | 'pulled' | 'failed', string[]>} */
	const done = { kept: [], fetched: [], built: [], skipped: [], pulled: [], failed: [] };
	/** @type {string[]} */
	const toBuild = [];
	/**
	 * Records that split pack `pack` could not be fetched or assembled, its
	 * scripts having said why, and goes on with the other packs: they do not
	 * depend on it, and the run still fails at the end. On Windows the usual
	 * cause is a toolchain holding symbolic links that Windows will not let
	 * this user create, which is said with how to allow it.
	 * @param {string} pack
	 */
	const splitFailed = (pack) => {
		done.failed.push(pack);
		if (WINDOWS && !canSymlink())
			note(
				`${pack}: its toolchains hold symbolic links, which Windows lets only an administrator create unless Developer Mode is on: turn it on (Settings > System > For developers > Developer Mode) and run this again, or run it in WSL`,
			);
	};
	for (const p of packs) {
		if (build.includes(p)) {
			toBuild.push(p);
			continue;
		}
		if (isSplit(p)) {
			if (noBash) {
				note(`skipping ${p}, a split pack, which its bash scripts assemble: ${noBash}`);
				done.skipped.push(p);
				continue;
			}
			say(`Fetching the ${p} pack's toolchain units`);
			let took = false;
			if (pull) {
				const r = pullUnits(p);
				if (r.status === 3) {
					note(`skipping ${p} (--build ${p} builds it here)`);
					done.skipped.push(p);
					continue;
				}
				if (r.status !== 0) process.exit(r.status);
				took = r.took;
			}
			const ensure = runBash(/** @type {string} */ (bash), SCRIPTS, 'pack-toolchain.sh', ['ensure', p, '--fetch-only', ...(latest ? ['--any'] : []), ...from], { env, stdout: 'ignore' }).status;
			if (ensure === 0) {
				const assembled = runBash(/** @type {string} */ (bash), packDir(p), 'build.sh', [...(latest ? ['--any'] : []), ...from], {
					env: { ...env, ALLOW_OTHER_TOOLCHAIN: latest ? '1' : '' },
				}).status;
				if (assembled !== 0) {
					splitFailed(p);
					continue;
				}
				// Assembled from units, not a stored build: no build's record is true of it now.
				await rm(path.join(TREES, p), { force: true });
				done.fetched.push(p);
				if (took) done.pulled.push(p);
			} else if (ensure === 3 || ensure === 4) {
				// A unit nobody has stored yet compiles for hours (LLVM, QEMU),
				// so it is never built unasked: --latest takes the newest stored
				// build of the whole pack instead, as a branch deploy does.
				if (latest) {
					note(`the toolchain store has no units of packs/${p} yet; taking the newest stored build of the whole pack (not these sources)`);
					if (await fetchPack(p, { any: true, log: note })) done.fetched.push(p);
					else done.skipped.push(p);
				} else {
					note(`the toolchain store lacks a unit of packs/${p} as checked out, and building one takes hours: rerun with --latest for the newest stored build (minutes), or --build ${p} to build it; skipping ${p}`);
					done.skipped.push(p);
				}
			} else splitFailed(p);
			continue;
		}
		const id = tree(p);
		if ((await installedTree(p)) === id) {
			done.kept.push(p);
			continue;
		}
		if (dirty(p)) note(`packs/${p} has changes not committed; the store has builds of committed sources only (--build ${p} builds yours)`);
		say(`Fetching the ${p} pack`);
		if (await fetchPack(p, { any: latest, log: note })) done.fetched.push(p);
		else if (!LINUX) {
			note(`no build of packs/${p} as checked out, and building one needs Linux: rerun with --latest for the newest build; skipping ${p}`);
			done.skipped.push(p);
		} else {
			note(`no build of packs/${p} as checked out; building it (or rerun with --latest to take the newest build)`);
			toBuild.push(p);
		}
	}

	if (toBuild.length > 0) {
		if (noBash) die(`building ${toBuild.join(', ')} needs bash: ${noBash}`);
		installDeps(toBuild, opts.install);
		for (const p of toBuild) {
			checkTools(p);
			say(`Building the ${p} pack (packs/${p}/build.sh)`);
			if (isSplit(p)) {
				const r = runBash(/** @type {string} */ (bash), packDir(p), 'build.sh', ['--no-fetch']);
				if (r.status !== 0) process.exit(r.status);
				await rm(path.join(TREES, p), { force: true });
			} else {
				const r = runBash(/** @type {string} */ (bash), packDir(p), 'build.sh', []);
				if (r.status !== 0) process.exit(r.status);
				// A pack built from committed sources is as current as a fetched
				// one, and is recorded so; one built from local changes is not.
				if (dirty(p)) await rm(path.join(TREES, p), { force: true });
				else await writeTree(p);
			}
			done.built.push(p);
		}
	}

	say('Done');
	if (done.kept.length) console.log(`up to date: ${done.kept.join(' ')}`);
	if (done.fetched.length) console.log(`downloaded: ${done.fetched.join(' ')}`);
	if (done.built.length) console.log(`built: ${done.built.join(' ')}`);
	if (done.skipped.length) console.log(`skipped: ${done.skipped.join(' ')} (see above)`);
	if (done.pulled.length) console.log(`WARNING: ${done.pulled.join(' ')}: units the store lacks are pull request #${pull}'s builds, made by its CI, not main's`);
	if (done.failed.length) console.log(`FAILED: ${done.failed.join(' ')} (see above)`);
	console.log(`
Run it:   cd app && pnpm run dev           (http://localhost:5173, reloads on edits)
Built:    cd app && pnpm run build && ${WINDOWS ? 'py' : 'python3'} ../serve.py build   (http://localhost:8080)
Checks:   cd app && pnpm run check && pnpm run test:unit`);
	if (done.failed.length) process.exit(1);
}

/**
 * Gives every file of LF_DIRS that git stores with LF, holds with CRLF and
 * reports unchanged its LF back, in place, and returns why bash cannot
 * run the scripts, or null. A checkout made with core.autocrlf before
 * .gitattributes asked for LF keeps CRLF until its files are written
 * again; bash cannot run such a script, and a pins, paths or env file read
 * with one gives each value a trailing CR. Only files git calls unmodified
 * are touched, so their content stays exactly what git has and nothing of
 * the user's is lost; one with changes of its own is named and left.
 * @returns {string | null}
 */
function fixLineEndings() {
	const ls = spawnSync('git', ['-C', LIGHT, 'ls-files', '--eol', '-z', '--', ...LF_DIRS], { encoding: 'utf8' });
	if (ls.status !== 0) return `git ls-files failed: ${ls.error?.message ?? ls.stderr.trim()}`;
	const crlf = ls.stdout
		.split('\0')
		.filter((entry) => /^i\/lf\s+w\/crlf\s/.test(entry))
		.map((entry) => entry.slice(entry.indexOf('\t') + 1));
	if (crlf.length === 0) return null;
	// Asked of the directories and not of each file, and the files given to
	// `git add` on its input: a checkout from before .gitattributes holds
	// hundreds of them, more than fit a Windows command line.
	const diff = spawnSync('git', ['-C', LIGHT, 'diff', '--name-only', '--relative', '-z', '--', ...LF_DIRS], { encoding: 'utf8' });
	if (diff.status !== 0) return `git diff failed: ${diff.error?.message ?? diff.stderr.trim()}`;
	const held = new Set(crlf);
	const changed = new Set(diff.stdout.split('\0').filter((file) => held.has(file)));
	const fixed = crlf.filter((file) => !changed.has(file));
	for (const file of fixed) {
		const where = path.resolve(LIGHT, file);
		writeFileSync(where, readFileSync(where).toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
	}
	if (fixed.length > 0) {
		// Git keeps calling a file modified after its line endings change
		// under new attributes, though it hashes to the very blob it has;
		// re-recording each one (the same blob, so nothing is staged) is what
		// `git add --renormalize` is for. Without it every pack looked as if
		// it had uncommitted changes, and was warned about.
		const add = spawnSync('git', ['-C', LIGHT, 'add', '--renormalize', '--pathspec-from-file=-', '--pathspec-file-nul'], { encoding: 'utf8', input: fixed.join('\0') });
		if (add.status !== 0) note(`git add --renormalize failed (${add.error?.message ?? add.stderr.trim()}): git status may list those files as modified, though they are not`);
		note(`gave ${fixed.length} unmodified files under ${LF_DIRS.join(', ')} back their LF line endings, as .gitattributes asks (they had CRLF from an older checkout)`);
	}
	// Most of what is under these directories bash never reads (tests,
	// fixtures), so a file left with CRLF is said, not refused: a script
	// that is one fails in bash naming itself.
	if (changed.size > 0) note(`left with CRLF line endings, as they have changes of your own: ${[...changed].join(', ')}; if bash runs or reads one, convert it to LF (your editor can)`);
	return null;
}

/**
 * Records HEAD's tree of `pack` as the one its installed copy was built from.
 * @param {string} pack
 */
async function writeTree(pack) {
	await mkdir(TREES, { recursive: true });
	await writeFile(path.join(TREES, pack), `${tree(pack)}\n`);
}

/**
 * Installs the Debian packages the packs about to be built list in their
 * deps.apt (a split pack: each unit's), with apt-get and sudo, or names
 * them when that is not possible or not wanted.
 * @param {string[]} packs
 * @param {boolean} install
 */
function installDeps(packs, install) {
	const files = packs.flatMap((p) => {
		const units = isSplit(p) ? readdirSync(path.join(packDir(p), 'toolchains')).map((u) => path.join(packDir(p), 'toolchains', u, 'deps.apt')) : [];
		return [path.join(packDir(p), 'deps.apt'), ...units].filter((f) => existsSync(f));
	});
	const pkgs = [
		...new Set(
			files.flatMap((f) =>
				readFileSync(f, 'utf8')
					.split('\n')
					.map((l) => l.trim())
					.filter((l) => l && !l.startsWith('#')),
			),
		),
	].sort();
	if (pkgs.length === 0) return;
	if (!install || onPath('apt-get') === null) {
		note(`building ${packs.join(' ')} needs these packages (Debian/Ubuntu names): ${pkgs.join(' ')}`);
		return;
	}
	say(`Installing the packages ${packs.join(' ')} needs to build`);
	for (const args of [['apt-get', 'update', '-q'], ['apt-get', 'install', '-y', '-q', '--no-install-recommends', ...pkgs]]) {
		if (spawnSync('sudo', args, { stdio: 'inherit' }).status !== 0) die(`sudo ${args.slice(0, 2).join(' ')} failed`);
	}
}

/**
 * Stops, naming it, when a pack's own build tool beyond the packages is
 * missing: said before an hour of building rather than after.
 * @param {string} pack
 */
function checkTools(pack) {
	const has = (/** @type {string} */ cmd, /** @type {string[]} */ args) => spawnSync(cmd, args, { encoding: 'utf8' });
	if (pack === 'scala') {
		const java = has('java', ['-version']);
		if (!/version "(1[7-9]|[2-9][0-9])/.test(`${java.stderr ?? ''}${java.stdout ?? ''}`)) die('the Scala pack builds with a JDK 17 or later (java -version)');
	}
	if (pack === 'python' && onPath('uv') === null) die('the Python pack builds with uv (https://docs.astral.sh/uv/: pipx install uv)');
	if (pack === 'php' && onPath('php') === null) die('the PHP pack builds with the PHP command line (sudo apt-get install php-cli)');
	if (pack === 'rust' && onPath('rustup') === null) die('the Rust pack builds with rustup (https://rustup.rs)');
}
