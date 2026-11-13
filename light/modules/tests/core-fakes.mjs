// A project snapshot over plain values, for the core's tests: the files as a
// record of path to text, the metadata as a record of key to stored value.
import { pathOf } from '../core/index.ts';

/** A snapshot of `files` and `meta` at `revision`. */
export function snapshotOf(files = {}, meta = {}, revision = 1) {
	return {
		revision,
		paths: () => Object.keys(files).map(pathOf),
		file: (path) => (Object.hasOwn(files, path) ? files[path] : null),
		files: () => ({ ...files }),
		meta: (binding) => (Object.hasOwn(meta, binding.key) ? binding.parse(meta[binding.key]) : null),
	};
}
