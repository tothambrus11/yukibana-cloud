// The Worker that serves https://yukibana.run: a registry (REGISTRY-DESIGN.md)
// whose every file is an object of one R2 bucket, answered under the
// registry's header rules (rules.mjs).
//
// Why a Worker and a bucket, and not a Worker's static assets as Light's
// own site has (../deploy/worker.js): an asset is at most 25 MiB and a
// version holds a bounded number of them, while a registry holds every
// build of every pack at once, some files of hundreds of MiB.
//
// A path is a key: `/packs/sha256-…/runner.js` is the object
// `packs/sha256-…/runner.js`. The bucket holds one object per path. A file
// worth compressing is stored compressed, with its encoding in the object's
// HTTP metadata, and is sent as it is stored (the edge decodes it for the
// rare client that does not accept the encoding); so one read answers a
// request, and nothing here compresses.
//
// It sets no cookie, reads none, and writes nothing: the bucket binding is
// only ever read. Filling the bucket is the deploy's (deploy.sh).

import { plainHeaders, refusal, ruleFor } from './rules.mjs';

/** What a person who opens the registry's address reads: text, never a document with scripts. */
const ABOUT = `This is a Yukibana registry: it serves the compilers and language servers that
Yukibana Light runs in the browser, and the frame they run in. It is meant to be
embedded by other sites, not visited. https://github.com/tothambrus11/yukibana-cloud
`;

/** A plain-text answer that is not a file. */
const text = (status, body, more = {}) => new Response(body.endsWith('\n') ? body : `${body}\n`, { status, headers: { ...plainHeaders(), ...more } });

/** The headers of a rule that let a page on another site read the answer, which a "not found" must carry too: without them a missing build looks like a registry that is down. */
function readable(headers) {
	const kept = {};
	for (const name of ['Access-Control-Allow-Origin', 'Cross-Origin-Resource-Policy']) if (name in headers) kept[name] = headers[name];
	return kept;
}

export default {
	/**
	 * @param {Request} request
	 * @param {{ REGISTRY: R2Bucket }} env the bucket
	 */
	async fetch(request, env) {
		const refused = refusal(request.method, (name) => request.headers.get(name));
		if (refused) return text(refused.status, refused.reason, refused.allow ? { Allow: refused.allow } : {});

		const { pathname } = new URL(request.url);
		if (pathname === '/') return text(200, ABOUT);
		const rule = ruleFor(pathname);
		if (rule === null) return text(404, 'Not a file of this registry.');

		const head = request.method === 'HEAD';
		// A condition the bucket cannot read (an etag without its quotes) is no condition: the file is sent whole.
		const object = head ? await env.REGISTRY.head(rule.key) : await env.REGISTRY.get(rule.key, { onlyIf: request.headers }).catch(() => env.REGISTRY.get(rule.key));
		if (object === null) return text(404, 'This registry does not have that file.', readable(rule.headers));

		const headers = new Headers(rule.headers);
		headers.set('ETag', object.httpEtag);
		// Whatever is stored, the edge may encode or decode it for the client that asked. And a cached
		// copy must not answer a service worker's script fetch, which `refusal` has to see: an
		// immutable build file would otherwise register from the browser's cache without asking here.
		headers.set('Vary', 'Accept-Encoding, Service-Worker');
		const encoding = object.httpMetadata?.contentEncoding;
		if (encoding) headers.set('Content-Encoding', encoding);
		// A get whose precondition did not hold comes back without a body: the client's copy is current.
		if (!head && !('body' in object)) return new Response(null, { status: 304, headers });
		headers.set('Content-Length', String(object.size));
		// `manual`: the body is already encoded as its Content-Encoding says.
		return new Response(head ? null : object.body, { headers, encodeBody: 'manual' });
	},
};
