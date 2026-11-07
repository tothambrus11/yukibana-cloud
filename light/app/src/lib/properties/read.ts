/**
 * What the app's property models share: reading a property as the value a
 * build uses, and the one availability a setting that always applies has.
 *
 * Temporary and app-side, as the models are: step 6 of
 * light/modules/DESIGN.md moves each into its language's package.
 */
import { AVAILABLE, readProperty, type Availability, type Property, type ProjectSnapshot } from '@yukibana/core';

/**
 * Returns the value `property` has in `snapshot` as a build uses it: what
 * is stored, or the default when nothing is or what is there is not
 * recognised (a reader that must tell those apart uses `readProperty`).
 */
export function valueOf<V>(snapshot: ProjectSnapshot, property: Property<V>): V {
	const read = readProperty(snapshot, property);
	return read.kind === 'value' ? read.value : property.default;
}

/** Returns `available`, whatever the project: for a setting that means something in every project of its language. */
export const always = (): Availability => AVAILABLE;
