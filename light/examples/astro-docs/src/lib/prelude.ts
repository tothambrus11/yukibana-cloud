/**
 * Snippet chaining: a playground that continues earlier ones on its page
 * (`continues={['load', 'parse']}`) runs their code before its own, as
 * one file, the way a reader following a tutorial would have typed it.
 *
 * The packages have no notion of a prelude (a run is a project's files and
 * an entry, std's `RunInput`), so the island makes one: the earlier
 * snippets' text, each under a comment naming it, then the playground's
 * own. Their text is the reader's edits when that playground has been
 * hydrated and edited, and the code the page was built with otherwise
 * (`<template data-snippet>`, written by Playground.astro). The cost is
 * line numbers: an error in the playground's own code is reported at its
 * line in the joined file.
 */

/** One earlier snippet, by the id the page gave it, and its text now. */
export interface PreludePart {
	readonly id: string;
	readonly code: string;
}

/**
 * Returns the file a playground whose code is `own` runs after `parts`:
 * the earlier snippets in the order given, then `own`, each under a
 * separator line that `comment` starts. With no parts it is `own`
 * unchanged. Each part ends in a newline in the
 * result, whether its text did or not.
 */
export function joinPrelude(parts: readonly PreludePart[], own: string, comment: string): string {
	if (parts.length === 0) return own;
	const lines: string[] = [];
	for (const part of parts) {
		lines.push(`${comment} ── from “${part.id}” ──`);
		lines.push(...withoutFinalNewline(part.code).split('\n'));
	}
	lines.push(`${comment} ── this snippet ──`);
	return `${lines.join('\n')}\n${own}`;
}

/** `text` without one final "\n", if it has one. */
function withoutFinalNewline(text: string): string {
	return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/** Live snippets: the text of each hydrated playground, by id, read when a later one runs. */
const live = new Map<string, () => string>();

/**
 * Says that the playground `id` is hydrated and its text now is what
 * `read` returns; returns the function that takes it back (on unmount).
 */
export function registerSnippet(id: string, read: () => string): () => void {
	live.set(id, read);
	return () => {
		if (live.get(id) === read) live.delete(id);
	};
}

/**
 * Returns the text of the snippet `id` now: its editor's, when hydrated,
 * else what the page was built with; throws naming the id when the page
 * has no such snippet, a mistake of the page's author.
 */
export function snippetText(id: string, root: ParentNode = document): string {
	const read = live.get(id);
	if (read !== undefined) return read();
	const template = root.querySelector<HTMLTemplateElement>(`template[data-snippet="${CSS.escape(id)}"]`);
	if (template === null) throw new RangeError(`This page has no snippet "${id}" to continue.`);
	return template.content.textContent ?? '';
}
