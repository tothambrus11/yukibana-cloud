/**
 * A server's Markdown, read by markdown.ts, drawn as DOM: the hover and a
 * completion's documentation. Every piece of text is a text node, never
 * HTML; a link is followed only when it is `http:` or `https:`, in a new
 * tab, and is text otherwise (a `command:` or `file:` link from a server
 * means nothing on a page). A code block is coloured with the editor's own
 * language and highlight style when the host gave the syntax packages and
 * the block is in the editor's language (or names none), as Monaco
 * colours a hover's code; else it is plain.
 */
import type { EditorState } from '@codemirror/state';
import type { SyntaxPackages } from './codemirror.ts';
import type { Inline, MarkupBlock } from './markdown.ts';

/** The class of the element a hover or a completion's documentation is drawn in. */
export const MARKUP_CLASS = 'cm-yukibana-markup';

/** Draws code in `language` (a fence's word, `''` for none) as coloured DOM, or null to leave it plain. */
export type CodeHighlighter = (code: string, language: string) => Node | null;

/**
 * Returns a highlighter that colours code as `state`'s editor colours its
 * own text: its language (`@codemirror/language`'s facet) and its
 * highlight style, for a block in that language or in none. Null when the
 * state has no language.
 */
export function stateHighlighter(syntax: SyntaxPackages, state: EditorState, document: Document): CodeHighlighter | null {
	const language = state.facet(syntax.language.language);
	if (language === null) return null;
	const highlighter = { style: (tags: Parameters<typeof syntax.language.highlightingFor>[1]) => syntax.language.highlightingFor(state, tags) };
	return (code, name) => {
		if (name !== '' && name !== language.name) return null;
		const out = document.createDocumentFragment();
		syntax.highlight.highlightCode(
			code,
			language.parser.parse(code),
			highlighter,
			(text, classes) => {
				if (classes === '') out.append(text);
				else {
					const span = document.createElement('span');
					span.className = classes;
					span.textContent = text;
					out.append(span);
				}
			},
			() => out.append('\n'),
		);
		return out;
	};
}

/** Draws `blocks` in `document`, code through `highlight` where it colours it. */
export function renderMarkup(document: Document, blocks: readonly MarkupBlock[], highlight: CodeHighlighter | null = null): HTMLElement {
	const root = document.createElement('div');
	root.className = MARKUP_CLASS;
	const inline = (parent: Node, spans: readonly Inline[]): void => {
		for (const span of spans) {
			switch (span.kind) {
				case 'text':
					parent.appendChild(document.createTextNode(span.text));
					break;
				case 'code': {
					const code = document.createElement('code');
					code.textContent = span.text;
					parent.appendChild(code);
					break;
				}
				case 'strong':
				case 'emphasis': {
					const element = document.createElement(span.kind === 'strong' ? 'strong' : 'em');
					inline(element, span.children);
					parent.appendChild(element);
					break;
				}
				case 'link': {
					if (/^https?:\/\//i.test(span.href)) {
						const link = document.createElement('a');
						link.href = span.href;
						link.target = '_blank';
						link.rel = 'noopener noreferrer';
						inline(link, span.children);
						parent.appendChild(link);
					} else inline(parent, span.children);
					break;
				}
				case 'break':
					parent.appendChild(document.createElement('br'));
					break;
			}
		}
	};
	for (const block of blocks) {
		switch (block.kind) {
			case 'heading': {
				const heading = document.createElement('div');
				heading.className = `${MARKUP_CLASS}-heading`;
				inline(heading, block.children);
				root.append(heading);
				break;
			}
			case 'rule':
				root.append(document.createElement('hr'));
				break;
			case 'code': {
				const pre = document.createElement('pre');
				const coloured = highlight?.(block.text, block.language) ?? null;
				if (coloured === null) pre.textContent = block.text;
				else pre.append(coloured);
				root.append(pre);
				break;
			}
			case 'paragraph': {
				const p = document.createElement('p');
				inline(p, block.children);
				root.append(p);
				break;
			}
			case 'list': {
				const list = document.createElement(block.ordered ? 'ol' : 'ul');
				for (const item of block.items) {
					const li = document.createElement('li');
					inline(li, item);
					list.append(li);
				}
				root.append(list);
				break;
			}
			case 'plain': {
				const p = document.createElement('p');
				p.className = `${MARKUP_CLASS}-plain`;
				p.textContent = block.text;
				root.append(p);
				break;
			}
		}
	}
	return root;
}
