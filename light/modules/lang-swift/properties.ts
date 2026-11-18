/**
 * Swift's build settings as @yukibana/core properties: its optimisation
 * level, saved with the project (no project file of the browser's sets
 * it) and sent with Run and Test; Download writes it into Package.swift.
 *
 * Swift's body carries the model (body.ts); a host that reads or writes the
 * level by its role imports the property from here.
 */
import { someProperty, type Property, type PropertyModel } from '../core/index.ts';
import { levelProperty, valueOf, type OptimizationLevel } from '../std/index.ts';

/**
 * swift-frontend's levels. `-Onone` is the default, what `swift build`
 * uses in its debug configuration and what Run used before the level could
 * be chosen. `-O` and `-Osize` need swift-toolchain-wasm swift-6.3.3-wasm-4
 * or later: earlier compilers overran their heap at those levels on 32-bit
 * hosts and trapped in free() on ordinary programs (packs/swift README,
 * "Optimization").
 */
export const SWIFT_LEVELS: readonly OptimizationLevel[] = [
	{ flag: '-Onone', label: '-Onone', default: true },
	{ flag: '-O', label: '-O' },
	{ flag: '-Osize', label: '-Osize' },
];

/** Swift's optimisation level: one of `SWIFT_LEVELS`' flags. */
export const SWIFT_LEVEL: Property<string> = levelProperty('@yukibana/lang-swift#optimization', SWIFT_LEVELS);

/** Swift's property model: the level, which is also its summary. */
export const SWIFT_MODEL: PropertyModel = { properties: [someProperty(SWIFT_LEVEL)], summary: (snapshot) => valueOf(snapshot, SWIFT_LEVEL) };
