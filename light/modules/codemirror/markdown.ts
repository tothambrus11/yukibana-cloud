/**
 * The Markdown a language server writes in a hover or a completion's
 * documentation, read into blocks and inline spans: what Monaco renders
 * there, without HTML. Headings, rules, fenced code (with its language),
 * paragraphs with hard breaks, lists; inline code, strong, emphasis,
 * links and backslash escapes. Anything else is text, as written.
 *
 * Pure, and producing data only: drawing it is bind.ts's `renderMarkup`,
 * which makes every piece of text a text node, so nothing a server sends
 * is ever read as HTML.
 *
 * It was once not read at all: a hover showed clangd's `### function
 * \`f\`` and `---` as they are, and `\*\*` with its backslashes.
 */
import type * as lsp from '../protocol/lsp.ts';

/** A span of a line of prose. */
export type Inline =
	| { readonly kind: 'text'; readonly text: string }
	| { readonly kind: 'code'; readonly text: string }
	| { readonly kind: 'strong' | 'emphasis'; readonly children: readonly Inline[] }
	/** A link: its text, and where it goes (any scheme: the renderer decides which it follows). */
	| { readonly kind: 'link'; readonly children: readonly Inline[]; readonly href: string }
	/** A hard line break: two spaces or a backslash at the end of a line. */
	| { readonly kind: 'break' };

/** A block of a hover or of a completion's documentation. */
export type MarkupBlock =
	| { readonly kind: 'heading'; readonly level: number; readonly children: readonly Inline[] }
	| { readonly kind: 'rule' }
	/** Code: a fenced block, or a `MarkedString` with a language; `language` is the fence's word, `''` when it has none. */
	| { readonly kind: 'code'; readonly language: string; readonly text: string }
	| { readonly kind: 'paragraph'; readonly children: readonly Inline[] }
	| { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly (readonly Inline[])[] }
	/** Plain text (`MarkupContent` of kind `plaintext`): shown with its line breaks, nothing in it read. */
	| { readonly kind: 'plain'; readonly text: string };

/**
 * Returns `contents` (a hover's, or a completion's documentation) as
 * blocks: Markdown read as the module comment says, plain text and a
 * `MarkedString` with a language as they are. A rule at the very start
 * or end, or two in a row, is dropped, as it separates nothing.
 */
export function markupBlocks(contents: lsp.Hover['contents'] | string): MarkupBlock[] {
	const items: readonly (lsp.MarkupContent | lsp.MarkedString)[] = Array.isArray(contents) ? contents : [contents as lsp.MarkupContent | lsp.MarkedString];
	const blocks: MarkupBlock[] = [];
	for (const item of items) {
		if (typeof item === 'string') blocks.push(...markdownBlocks(item));
		else if ('language' in item) blocks.push({ kind: 'code', language: item.language, text: item.value });
		else if (item.kind === 'markdown') blocks.push(...markdownBlocks(item.value));
		else if (item.value.trim() !== '') blocks.push({ kind: 'plain', text: item.value.replace(/\s+$/, '') });
	}
	return blocks.filter((block, i, all) => block.kind !== 'rule' || (i > 0 && i < all.length - 1 && all[i - 1]?.kind !== 'rule'));
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/** Reads Markdown's blocks, line by line. */
export function markdownBlocks(markdown: string): MarkupBlock[] {
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	const blocks: MarkupBlock[] = [];
	let paragraph: string[] = [];
	let list: { ordered: boolean; items: string[] } | null = null;
	const flush = (): void => {
		if (paragraph.length > 0) blocks.push({ kind: 'paragraph', children: paragraphSpans(paragraph) });
		paragraph = [];
		if (list !== null) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map((item) => inlineSpans(item)) });
		list = null;
	};
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] ?? '';
		const fence = FENCE.exec(line);
		if (fence !== null) {
			flush();
			const marker = fence[1] ?? '```';
			const code: string[] = [];
			for (i += 1; i < lines.length && !(lines[i] ?? '').trimStart().startsWith(marker); i += 1) code.push(lines[i] ?? '');
			blocks.push({ kind: 'code', language: fence[2] ?? '', text: code.join('\n') });
			continue;
		}
		if (line.trim() === '') {
			flush();
			continue;
		}
		if (RULE.test(line)) {
			flush();
			blocks.push({ kind: 'rule' });
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading !== null) {
			flush();
			blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, children: inlineSpans(heading[2] ?? '') });
			continue;
		}
		const bullet = BULLET.exec(line);
		const numbered = bullet === null ? NUMBERED.exec(line) : null;
		const item = bullet ?? numbered;
		if (item !== null) {
			const ordered = numbered !== null;
			if (paragraph.length > 0 || (list !== null && list.ordered !== ordered)) flush();
			list ??= { ordered, items: [] };
			list.items.push(item[1] ?? '');
			continue;
		}
		if (list !== null && /^\s+/.test(line)) {
			// A continuation of the list's last item.
			list.items[list.items.length - 1] += ` ${line.trim()}`;
			continue;
		}
		if (list !== null) flush();
		paragraph.push(line);
	}
	flush();
	return blocks;
}

/** A paragraph's lines as spans: joined by a space, or by a break where a line ends in two spaces or a backslash. */
function paragraphSpans(lines: readonly string[]): Inline[] {
	const spans: Inline[] = [];
	lines.forEach((line, i) => {
		const hard = / {2,}$/.test(line) || /(?<!\\)\\$/.test(line);
		const text = line.replace(/ {2,}$/, '').replace(/(?<!\\)\\$/, '').trim();
		spans.push(...inlineSpans(text));
		if (i < lines.length - 1) spans.push(hard ? { kind: 'break' } : { kind: 'text', text: ' ' });
	});
	return merged(spans);
}

/** The ASCII punctuation a backslash escapes, as CommonMark says. */
const ESCAPABLE = /[!-/:-@[-`{-~]/;

/** Reads one line's inline spans. */
export function inlineSpans(text: string): Inline[] {
	const spans: Inline[] = [];
	let plain = '';
	const push = (span: Inline): void => {
		if (plain !== '') spans.push({ kind: 'text', text: plain });
		plain = '';
		spans.push(span);
	};
	let i = 0;
	while (i < text.length) {
		const char = text[i] ?? '';
		const next = text[i + 1] ?? '';
		if (char === '\\' && ESCAPABLE.test(next)) {
			plain += next;
			i += 2;
			continue;
		}
		if (char === '`') {
			const run = /^`+/.exec(text.slice(i))?.[0] ?? '`';
			const end = text.indexOf(run, i + run.length);
			if (end > 0) {
				const code = text.slice(i + run.length, end);
				push({ kind: 'code', text: /^ .* $/.test(code) ? code.slice(1, -1) : code });
				i = end + run.length;
				continue;
			}
			plain += run;
			i += run.length;
			continue;
		}
		if ((char === '*' || char === '_') && !(char === '_' && /\w/.test(text[i - 1] ?? ''))) {
			const marker = next === char ? char + char : char;
			const end = closing(text, marker, i + marker.length);
			if (end > i + marker.length) {
				push({ kind: marker.length === 2 ? 'strong' : 'emphasis', children: inlineSpans(text.slice(i + marker.length, end)) });
				i = end + marker.length;
				continue;
			}
		}
		if (char === '[') {
			const link = /^\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(text.slice(i));
			if (link !== null) {
				push({ kind: 'link', children: inlineSpans(link[1] ?? ''), href: link[2] ?? '' });
				i += link[0].length;
				continue;
			}
		}
		plain += char;
		i += 1;
	}
	if (plain !== '') spans.push({ kind: 'text', text: plain });
	return spans;
}

/** Where `marker` closes an emphasis opened before `from`: an unescaped occurrence not followed by a space before it; -1 when none. */
function closing(text: string, marker: string, from: number): number {
	for (let at = text.indexOf(marker, from); at >= 0; at = text.indexOf(marker, at + 1)) {
		if (text[at - 1] === '\\' || /\s/.test(text[at - 1] ?? ' ')) continue;
		if (marker.length === 1 && text[at + 1] === marker) {
			at += 1;
			continue;
		}
		return at;
	}
	return -1;
}

/** Joins neighbouring text spans. */
function merged(spans: readonly Inline[]): Inline[] {
	const out: Inline[] = [];
	for (const span of spans) {
		const last = out.at(-1);
		if (span.kind === 'text' && last?.kind === 'text') out[out.length - 1] = { kind: 'text', text: last.text + span.text };
		else out.push(span);
	}
	return out;
}
