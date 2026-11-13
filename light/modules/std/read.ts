/**
 * What the languages' property models share: reading a property as the
 * value a build uses, and the one availability a setting that always
 * applies has.
 */
import { AVAILABLE, readProperty, type Availability, type Property, type PropertyModel, type ProjectSnapshot } from '../core/index.ts';

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

/** The model of a language whose build nothing chooses: no property, and an empty summary. */
export const NO_PROPERTIES: PropertyModel = { properties: [], summary: () => '' };
