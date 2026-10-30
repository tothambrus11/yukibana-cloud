// Runs the CI a download carries (src/lib/export-tooling.ts) on each sample
// project, as the services would: every job in its own container of the
// image it names, with the image's setup and then the job's steps, on the
// downloaded files. A job that fails is a check that fails, with the end of
// its output. The setup and the steps are the same for GitHub, GitLab,
// Forgejo and Azure, which only wrap them in their own files; those files
// are parsed (and checked) by tests/export.mjs.
//
//   node tests/export-ci.mjs [language[:build] ...]      e.g. cpp cpp:meson java:gradle
//
// Needs Docker. Without arguments, every language with every build system
// that fits its sample. Set KEEP=1 to keep the projects, JOBS=test,format
// to run only those jobs, DOCKER_ARGS to give every container more `docker
// run` arguments (a mount of a package mirror's configuration, say).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LANGUAGES } from '../src/lib/languages.ts';
import { buildSystems, exportProject } from '../src/lib/export.ts';
import { imageSetup, jobsFor } from '../src/lib/export-tooling.ts';

/**
 * Behind an HTTPS proxy with its own CA (HTTPS_PROXY and a CA bundle in
 * NODE_EXTRA_CA_CERTS, as in a sandbox): the containers use the host's
 * network and trust that CA, through the variables each tool reads. Not
 * part of the CI itself, which runs on the services' open network.
 */
function proxyArgs() {
	const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
	const ca = process.env.NODE_EXTRA_CA_CERTS;
	if (!proxy || !ca) return [];
	const caIn = '/etc/ssl/yukibana-proxy-ca.crt';
	const javaCerts = '/etc/ssl/certs/java/cacerts';
	const url = new URL(proxy);
	const vars = {
		// HTTPS only: the proxy refuses plain HTTP, which apt uses and reaches directly.
		HTTPS_PROXY: proxy, https_proxy: proxy,
		NO_PROXY: process.env.NO_PROXY ?? process.env.no_proxy ?? '', no_proxy: process.env.no_proxy ?? process.env.NO_PROXY ?? '',
		SSL_CERT_FILE: caIn, CURL_CA_BUNDLE: caIn, GIT_SSL_CAINFO: caIn, NODE_EXTRA_CA_CERTS: caIn, REQUESTS_CA_BUNDLE: caIn, PIP_CERT: caIn, CARGO_HTTP_CAINFO: caIn,
		JAVA_TOOL_OPTIONS: `-Djavax.net.ssl.trustStore=/tmp/java-cacerts -Djavax.net.ssl.trustStoreType=JKS -Dhttps.proxyHost=${url.hostname} -Dhttps.proxyPort=${url.port}`,
		SBT_OPTS: `-Djavax.net.ssl.trustStore=/tmp/java-cacerts -Dhttps.proxyHost=${url.hostname} -Dhttps.proxyPort=${url.port}`,
	};
	return ['--network', 'host', '-v', `${ca}:${caIn}:ro`, ...(existsSync(javaCerts) ? ['-v', `${javaCerts}:/tmp/java-cacerts:ro`] : []), ...Object.entries(vars).flatMap(([k, v]) => ['-e', `${k}=${v}`])];
}
const PROXY = [...proxyArgs(), ...(process.env.DOCKER_ARGS ?? '').split(' ').filter(Boolean)];

const work = mkdtempSync(join(tmpdir(), 'yukibana-ci-'));
const only = process.env.JOBS ? new Set(process.env.JOBS.split(',')) : null;
const failures = [];

const targets = process.argv.slice(2).length
	? process.argv.slice(2).map((t) => t.split(':'))
	: LANGUAGES.flatMap((l) => buildSystems(l, l.sample).map((b) => [l.id, b.id]));

for (const [id, buildId] of targets) {
	const language = LANGUAGES.find((l) => l.id === id);
	if (!language) throw new Error(`no language ${id}`);
	const build = buildSystems(language, language.sample).find((b) => !buildId || b.id === buildId);
	if (!build) throw new Error(`${id}: no build system ${buildId}`);
	const name = `${id}-${build.id}`;
	const { files } = exportProject(language, language.sample, null, { build: build.id, ci: 'github', devcontainer: true, gitattributes: true });
	const dir = join(work, name);
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	const project = { language, files: language.sample, paths: Object.keys(files).sort(), optimization: null };
	for (const job of jobsFor(id, build.ci(project), language.sample)) {
		if (only && !only.has(job.id)) continue;
		// Each job starts from the downloaded files, as a fresh checkout does.
		const copy = join(work, `${name}-${job.id}`);
		spawnSync('cp', ['-r', dir, copy]);
		const e = job.environment;
		// One stream, in order, so that a failing step's output ends the log rather than hiding before another stream's.
		const script = ['exec 2>&1', ...imageSetup(e).map((s) => `${s} >/dev/null`), ...job.steps.flatMap((s) => [`echo ${JSON.stringify(`==> ${s.name}`)}`, s.run])].join('\n');
		const env = Object.entries(e.variables).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
		const started = Date.now();
		const r = spawnSync('docker', ['run', '--rm', '-i', '-v', `${copy}:/work`, '-w', '/work', ...PROXY, ...env, e.image, 'bash', '-euo', 'pipefail', '-s'], { input: script, encoding: 'utf8', maxBuffer: 256 << 20, timeout: 40 * 60_000 });
		const ok = r.status === 0;
		const seconds = ((Date.now() - started) / 1000).toFixed(0);
		console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${job.name} in ${e.image} (${seconds} s)`);
		if (!ok) failures.push(`${name}: ${job.name}\n${`${r.stdout ?? ''}${r.stderr ?? ''}${r.error ?? ''}`.trim().split('\n').slice(-40).join('\n')}`);
		if (!process.env.KEEP) spawnSync('docker', ['run', '--rm', '-v', `${work}:/w`, 'debian:trixie', 'rm', '-rf', `/w/${name}-${job.id}`]);
	}
}

if (!process.env.KEEP) rmSync(work, { recursive: true, force: true });
else console.log(`kept in ${work}`);
if (failures.length) {
	console.log(`\n${failures.length} job(s) failed:\n${failures.map((f) => `  - ${f}`).join('\n\n')}`);
	process.exit(1);
}
