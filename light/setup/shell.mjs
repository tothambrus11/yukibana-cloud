// Running the bash half of the build: a split pack's toolchain scripts
// (scripts/pack-store.sh, scripts/pack-toolchain.sh, packs/<pack>/build.sh),
// which this tool calls rather than reimplements, as their keys must stay
// the ones CI computes. On Windows that is Git for Windows' bash, which has
// everything those scripts read except zstd; zstd.mjs stands in for it.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WINDOWS = process.platform === 'win32';
/** The directory holding the `zstd` stand-in, put first on PATH for bash when no zstd is installed. */
const SHIM = fileURLToPath(new URL('bin', import.meta.url));

/**
 * The first executable called `name` on PATH, absolute, or null. On
 * Windows it looks for `name`.exe and skips System32 and WindowsApps, whose
 * bash.exe starts WSL rather than running a script.
 * @param {string} name
 * @returns {string | null}
 */
export function onPath(name) {
	const system = WINDOWS ? [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'), path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps')] : [];
	for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
		if (!dir || system.some((s) => path.relative(s, dir) === '')) continue;
		const file = path.join(dir, WINDOWS ? `${name}.exe` : name);
		if (existsSync(file)) return file;
	}
	return null;
}

/**
 * The bash that runs the toolchain scripts, or null when there is none:
 * LIGHT_BASH when set; on Windows, Git for Windows' (its bin/bash.exe sets
 * up the PATH its tools are on); elsewhere, bash on PATH.
 * @returns {string | null}
 */
export function findBash() {
	if (process.env.LIGHT_BASH) return process.env.LIGHT_BASH;
	if (!WINDOWS) return onPath('bash');
	const git = onPath('git');
	const candidates = [
		...[process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]
			.filter((dir) => typeof dir === 'string' && dir !== '')
			.map((dir) => path.join(/** @type {string} */ (dir), 'Git', 'bin', 'bash.exe')),
		// git.exe is in <Git>\cmd or <Git>\bin; bash.exe in <Git>\bin.
		...(git ? [path.join(path.dirname(path.dirname(git)), 'bin', 'bash.exe')] : []),
	];
	return candidates.find((file) => existsSync(file)) ?? onPath('bash');
}

/**
 * What bash needs that it does not have, as a sentence, or null when it can
 * run the toolchain scripts. Checks the tools inside bash, not on Node's
 * PATH: Git for Windows' bash sees its own.
 * @param {string | null} bash
 * @returns {string | null}
 */
export function bashProblem(bash) {
	if (bash === null) return WINDOWS ? 'no bash: install Git for Windows (https://git-scm.com), or run setup in WSL' : 'no bash on PATH';
	const r = spawnSync(bash, ['-c', 'for t in git curl tar sha256sum awk find node; do command -v "$t" >/dev/null || printf "%s " "$t"; done'], { encoding: 'utf8' });
	if (r.error || r.status !== 0) return `${bash} cannot be run: ${r.error?.message ?? r.stderr}`;
	const missing = r.stdout.trim();
	return missing ? `bash (${bash}) has no ${missing.split(' ').join(', ')}` : null;
}

/**
 * Runs the bash script `name` in directory `dir` with `args`, from that
 * directory, stdin and stderr the user's, and returns its exit status and
 * stdout. The script is named relative to its directory, so no Windows
 * path ever has to be spelled for bash. `env` adds to the environment;
 * zstd's stand-in is put first on PATH when bash has no zstd.
 * @param {string} bash
 * @param {string} dir absolute
 * @param {string} name e.g. pack-store.sh
 * @param {string[]} args
 * @param {{ env?: Record<string, string>, stdout?: 'pipe' | 'inherit' | 'ignore' }} [options]
 * @returns {{ status: number, stdout: string }}
 */
export function runBash(bash, dir, name, args, { env = {}, stdout = 'inherit' } = {}) {
	// A script that wants zstd finds the stand-in only when bash has none;
	// the PATH bash sees is its own, so the check is made inside it.
	const prelude = `command -v zstd >/dev/null || PATH="$(cygpath -u "$LIGHT_SETUP_SHIM" 2>/dev/null || printf %s "$LIGHT_SETUP_SHIM"):$PATH"; exec "$0" "$@"`;
	const r = spawnSync(bash, ['-c', prelude, `./${name}`, ...args], {
		cwd: dir,
		env: { ...process.env, ...(WINDOWS ? { MSYS: msys() } : {}), ...env, LIGHT_SETUP_SHIM: SHIM },
		stdio: ['inherit', stdout === 'pipe' ? 'pipe' : stdout, 'inherit'],
		encoding: 'utf8',
	});
	if (r.error) throw new Error(`${path.join(dir, name)} cannot be run: ${r.error.message}`);
	return { status: r.status ?? 1, stdout: r.stdout ?? '' };
}

/**
 * MSYS's settings for the scripts on Windows: the user's, with symbolic
 * links made as Windows' own. A toolchain's links are recorded as links
 * (toolchain-manifest.mjs) and read back by Node, so the copy MSYS makes by
 * default would be refused at adoption anyway, and fails sooner: tar meets
 * a link before its target. `nativestrict` makes a real link or fails
 * saying so; never a copy.
 * @returns {string}
 */
function msys() {
	const own = (process.env.MSYS ?? '').split(' ').filter((word) => word && !word.startsWith('winsymlinks'));
	return [...own, 'winsymlinks:nativestrict'].join(' ');
}

/**
 * Whether this user may create symbolic links: always on Linux and macOS;
 * on Windows, as an administrator or with Developer Mode on. Tried, not
 * guessed, in a scratch directory that is removed again.
 * @returns {boolean}
 */
export function canSymlink() {
	const dir = mkdtempSync(path.join(tmpdir(), 'light-setup-link-'));
	try {
		symlinkSync('target', path.join(dir, 'link'), 'file');
		return true;
	} catch {
		return false;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
