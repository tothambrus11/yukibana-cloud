/**
 * What the language packages' export bodies share (std/export.ts): the
 * environments, steps and jobs a toolchain or a build system is written
 * with, and Spotless, the format check of the build files of more than one
 * language. Loaded with the first of those bodies, never with std's index:
 * nothing here is a token.
 *
 * Pure, like the bodies: the same arguments always give the same text.
 */
import type { Files } from '../core/index.ts';
import type { Environment, Extra, JobSpec, LocalCheck, SourceHutEnvironment, Step } from './export.ts';

/** Merges extras into an environment: packages appended without repeats, variables overridden. */
export function withExtra(env: Environment, ...extras: readonly (Extra | undefined)[]): Environment {
	const union = (a: readonly string[], b: readonly string[] | undefined) => [...new Set([...a, ...(b ?? [])])];
	let out = env;
	for (const extra of extras) {
		if (!extra) continue;
		out = {
			image: extra.image ?? out.image,
			apt: union(out.apt, extra.apt),
			setup: union(out.setup, extra.setup),
			variables: { ...out.variables, ...extra.variables },
			sourcehut: {
				image: out.sourcehut.image,
				packages: union(out.sourcehut.packages, extra.sourcehut?.packages),
				setup: union(out.sourcehut.setup, extra.sourcehut?.setup),
			},
		};
	}
	return out;
}

/** Returns an environment from its parts: `image`, SourceHut's machine, and what `more` adds, with nothing else by default. */
export function env(image: string, sourcehut: SourceHutEnvironment, more: Extra = {}): Environment {
	return withExtra({ image, apt: [], setup: [], variables: {}, sourcehut }, more);
}

/** Returns the project's files whose names match `pattern`, sorted, outside hidden folders. */
export function sources(files: Files, pattern: RegExp): string[] {
	return Object.keys(files)
		.filter((p) => pattern.test(p) && !p.split('/').some((s) => s.startsWith('.')))
		.sort();
}

/**
 * Shell for the files git tracks that match `globs`, NUL-separated, piped
 * into `command` (xargs, which runs nothing when there are none): the
 * project's files as they are when the check runs, so a file added later is
 * checked too, and nothing a build wrote is. The checkout's owner may not be
 * the user the job runs as (a container's root), which git refuses without
 * the folder marked safe.
 */
export function trackedFiles(globs: readonly string[], command: string): string {
	return `git config --global --add safe.directory "$PWD"\ngit ls-files -z -- ${globs.map((g) => `'${g}'`).join(' ')} | xargs -0 -r ${command}`;
}

/** Returns steps that run with `cwd` the project folder: one step per `[name, run]` of `commands`. */
export const steps = (...commands: readonly (readonly [string, string])[]): Step[] => commands.map(([name, run]) => ({ name, run }));

/** Returns a job that builds and tests, with id `test`. */
export const testJob = (name: string, s: readonly Step[], extra?: Extra): JobSpec => ({ id: 'test', name, steps: s, ...(extra ? { extra } : {}) });

// ---- Java and Kotlin: Spotless

/**
 * The Spotless plugins that check (`spotless:check`, `spotlessCheck`) and fix
 * (`spotless:apply`, `spotlessApply`) a Java or Kotlin project's format, with
 * google-java-format or ktlint at the versions Light formats with
 * (the language packages' export.ts). Spotless fetches the formatter from Maven Central as
 * the build fetches everything else, so the version lives in the build file
 * and nothing is downloaded by hand.
 */
const SPOTLESS_MAVEN_VERSION = '3.11.0';
/** The Spotless Gradle plugin's version, which a build.gradle.kts's `plugins` block names. */
export const SPOTLESS_GRADLE_VERSION = '8.11.0';
/** CI's Spotless check of a project built with Gradle. */
export const SPOTLESS_GRADLE_CHECK = 'gradle spotlessCheck --no-daemon --console=plain';

/** Spotless as a developer runs it with Maven: the check, and the command that formats every file. */
export const MAVEN_LOCAL: LocalCheck = { check: 'mvn spotless:check', fix: 'mvn spotless:apply' };
/** Spotless as a developer runs it with Gradle. */
export const GRADLE_LOCAL: LocalCheck = { check: 'gradle spotlessCheck', fix: 'gradle spotlessApply' };

/**
 * Returns CI's format check for a Java or Kotlin project: Spotless, as the
 * build file written for it configures it. None for a project that brings
 * its own build file (`own`), which may not have Spotless, or that has no
 * sources (`sources`, its .java or .kt files).
 */
export function spotlessJob(files: Files, own: string, sources: readonly string[], check: string, local: LocalCheck): JobSpec[] {
	if (own in files || !sources.length) return [];
	return [{ id: 'format', name: 'Format', steps: steps(['Spotless', check]), local }];
}

/**
 * Returns Spotless's plugin of a pom.xml, which runs `formatter` (its
 * configuration's lines, the formatter's own element) over the project:
 * `style` is what its comment says the formatter checks.
 */
export function spotlessMaven(formatter: readonly string[], style: string): string[] {
	return [
		'      <plugin>',
		'        <groupId>com.diffplug.spotless</groupId>',
		'        <artifactId>spotless-maven-plugin</artifactId>',
		`        <version>${SPOTLESS_MAVEN_VERSION}</version>`,
		`        <!-- mvn spotless:check checks the format (${style}), mvn spotless:apply fixes it. -->`,
		'        <configuration>',
		...formatter,
		'        </configuration>',
		'      </plugin>',
	];
}

/**
 * Returns Spotless's block of a build.gradle.kts, which runs `formatter`
 * (its lines inside the block): `style` is what its comment says it checks.
 * `isEnforceCheck = false`: Spotless would otherwise make `gradle build`
 * fail on a file's format; CI checks it as a job of its own, so a build is
 * a build.
 */
export function spotlessGradle(formatter: readonly string[], style: string): string[] {
	return [
		`// gradle spotlessCheck checks the format (${style}), gradle spotlessApply fixes it.`,
		'spotless {',
		'    isEnforceCheck = false',
		...formatter,
		'}',
		'',
	];
}
