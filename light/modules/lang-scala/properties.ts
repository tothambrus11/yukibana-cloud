/**
 * Scala's build settings as @yukibana/core properties: whether the
 * Scala.js linker runs its optimizer, saved with the project and sent with
 * Run. Download cannot carry it: the downloaded project is an sbt project
 * for the JVM, which has no such switch.
 *
 * Scala's body carries the model (body.ts); a host that reads or writes the
 * level by its role imports the property from here.
 */
import { someProperty, type Property, type PropertyModel } from '../core/index.ts';
import { levelProperty, valueOf, type OptimizationLevel } from '../std/index.ts';

/**
 * The Scala.js linker's optimizer, off or on. Off is the default because it
 * is what Run did before (each Run links the whole program, and the
 * optimizer adds about a second to that); on is what `sbt fastLinkJS` does,
 * and makes collection-heavy programs about a fifth faster (packs/scala
 * README, "Optimization").
 */
export const SCALA_LEVELS: readonly OptimizationLevel[] = [
	{ flag: 'off', label: 'Optimizer off', default: true },
	{ flag: 'on', label: 'Optimizer on' },
];

/** Scala's optimisation level: `off` or `on`. */
export const SCALA_LEVEL: Property<string> = levelProperty('@yukibana/lang-scala#optimization', SCALA_LEVELS);

/** Scala's property model: the level, which is also its summary. */
export const SCALA_MODEL: PropertyModel = { properties: [someProperty(SCALA_LEVEL)], summary: (snapshot) => valueOf(snapshot, SCALA_LEVEL) };
