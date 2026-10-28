/**
 * Where a workspace's files are, as a language server and an editor name
 * them: a project path (`src/main.py`) and the URI of that path under a
 * workspace root (`file:///workspace/src/main.py`).
 *
 * The root is a value the host chooses, never a constant here. Light's app
 * has one workspace and calls it `file:///workspace/`; a page of many
 * snippets gives each its own (`inmemory://snippet-3/`), because the page
 * has one editor model per URI and two snippets may both hold main.hylo.
 * The map between a snippet's URIs and the one root its language server
 * sees is built from these roots by the language server session; this
 * module only names paths and turns them into URIs and back.
 *
 * A project path is relative, `/`-separated, and has no empty, `.` or `..`
 * segment ({@link pathProblem}); the workspace folder itself is `''`.
 */

/**
 * Why `path` cannot name a file or folder of a workspace, as a sentence a
 * host shows beside the name a person typed, or null when it can. It is
 * relative, `/`-separated, has no empty, `.` or `..` segment, and no
 * character a file system of a person's download would refuse
 * (`\ : * ? " < > |`), so a project exported as a zip unpacks everywhere.
 */
export function pathProblem(path: string): string | null {
	if (path === '') return 'The name is empty.';
	if (path.startsWith('/') || path.endsWith('/')) return 'A name cannot start or end with "/".';
	for (const segment of path.split('/')) {
		if (segment === '' || segment === '.' || segment === '..') return `"${segment}" is not a valid name.`;
		if (/[\\:*?"<>|]/.test(segment)) return 'A name cannot contain \\ : * ? " < > |.';
	}
	return null;
}

/** The folder containing a project path, `''` for one at the root. */
export function parentOf(path: string): string {
	const i = path.lastIndexOf('/');
	return i < 0 ? '' : path.slice(0, i);
}

/** The last segment of a project path: the file's or folder's own name. */
export function baseName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * A URI taken apart as an editor's URI object holds it: the scheme, the
 * authority, and the path *decoded* (Monaco's `Uri.path` is). Anything with
 * these three fields will do, so a host passes its editor's URI as it is.
 */
export interface UriParts {
	scheme: string;
	authority: string;
	path: string;
}

/**
 * One workspace root: the folder every file of one workspace is under, as
 * its language server and its editor see it.
 */
export interface WorkspaceRoot {
	/** The root as given, ending in `/`: what a language server receives as `rootUri` and its one workspace folder. */
	readonly uri: string;
	/** The root's decoded path, ending in `/` (`/workspace/`): how an editor's messages name a file of the workspace. */
	readonly path: string;
	/**
	 * The URI of project path `path` (which {@link pathProblem} accepts;
	 * `''` is the root itself), each segment percent-encoded, so `#`, `?`
	 * and spaces in a name never end the path.
	 */
	uriOf(path: string): string;
	/**
	 * The project path `uri` names, or null for a URI outside this
	 * workspace (another scheme, another snippet's authority, a library
	 * file a server points into). `''` is the root itself. `uri` is a URI
	 * string as a language server sends it (percent-encoded, decoded here)
	 * or an editor's URI object ({@link UriParts}, path already decoded).
	 * A string that does not decode is outside: no path of ours encodes to
	 * it. So is one whose path under the root is not a project path
	 * ({@link pathProblem}): `..`, `%2E%2E`, an empty segment or a trailing
	 * `/` would otherwise name a file outside the root, or a second spelling
	 * of one inside it, and a caller keying files by path would trust it.
	 * An encoded `/` (`%2F`) is outside too, since {@link uriOf} never
	 * writes one: `a%2Fb` and `a/b` are two URIs, and only the second is
	 * the file `a/b`.
	 */
	pathOf(uri: string | UriParts): string | null;
}

/** scheme `:` [`//` authority] path, without query or fragment: the parts a workspace URI has. */
const URI = /^([A-Za-z][A-Za-z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)$/;

/**
 * `uri`'s parts with its path decoded, or null when it is not one a
 * workspace can hold (a query, a fragment, a bad escape, an encoded `/`,
 * which decoding would turn into a separator no segment of ours contains).
 */
function partsOf(uri: string): UriParts | null {
	const match = URI.exec(uri);
	if (match === null || /%2f/i.test(match[3] ?? '')) return null;
	try {
		return { scheme: match[1] ?? '', authority: match[2] ?? '', path: decodeURIComponent(match[3] ?? '') };
	} catch {
		return null;
	}
}

/**
 * The workspace whose root is `uri`, which ends in `/` and has no query
 * or fragment (`file:///workspace/`, `inmemory://snippet-3/`). Schemes are
 * compared without case, as URIs define them; authorities and paths
 * exactly, as an editor keeps them.
 *
 * Throws a RangeError naming `uri` otherwise: a root is a value the host
 * writes once, so a wrong one is a mistake in the host to be fixed, not
 * input to be shown to a reader.
 */
export function workspaceRoot(uri: string): WorkspaceRoot {
	const root = uri.endsWith('/') ? partsOf(uri) : null;
	if (root === null || !root.path.startsWith('/')) {
		throw new RangeError(`${JSON.stringify(uri)} is not a workspace root: a root is an absolute URI ending in "/" with no query or fragment`);
	}
	const scheme = root.scheme.toLowerCase();
	return {
		uri,
		path: root.path,
		uriOf: (path) => uri + (path === '' ? '' : path.split('/').map(encodeURIComponent).join('/')),
		pathOf: (target) => {
			const parts = typeof target === 'string' ? partsOf(target) : target;
			if (parts === null || parts.scheme.toLowerCase() !== scheme || parts.authority !== root.authority) return null;
			if (parts.path === root.path.slice(0, -1)) return '';
			if (!parts.path.startsWith(root.path)) return null;
			const path = parts.path.slice(root.path.length);
			return path === '' || pathProblem(path) === null ? path : null;
		},
	};
}
