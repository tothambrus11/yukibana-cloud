/**
 * Which of a Kotlin project's files are its sources, and whether they are
 * in Maven's layout: what the download's build files read (export.ts), and
 * what decides whether Maven is offered (download.ts), which must not load
 * them.
 */
import { AVAILABLE, type Availability, type ProjectSnapshot } from '../core/index.ts';

/** `true` iff `path` is one of a project's Kotlin files: a .kt or .kts file, Gradle's own scripts aside. */
export function isKotlinSource(path: string): boolean {
	return /\.kts?$/.test(path) && !/(^|\/)(build|settings)\.gradle\.kts$/.test(path);
}

/**
 * Returns whether `snapshot`'s Kotlin files are all in Maven's layout
 * (src/main/kotlin and src/test/kotlin), the only one kotlin-maven-plugin
 * builds: it cannot leave a folder's tests out of its sources. Reads the
 * snapshot's paths only.
 */
export function mavenLayout(snapshot: ProjectSnapshot): Availability {
	const outside = snapshot.paths().find((p) => isKotlinSource(p) && !p.startsWith('src/main/kotlin/') && !p.startsWith('src/test/kotlin/'));
	return outside === undefined ? AVAILABLE : { kind: 'unavailable', reason: `Maven builds only Maven's layout, and ${outside} is outside src/main/kotlin and src/test/kotlin.` };
}
