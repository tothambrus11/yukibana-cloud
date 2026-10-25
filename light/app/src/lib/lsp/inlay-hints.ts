/**
 * A server's inlay hints (`textDocument/inlayHint`) as Monaco shows them,
 * for any language: the label (a string, or parts joined as Monaco draws
 * them), its tooltip, the edits a double click applies (HLS's writes a
 * local binding's signature), its kind and padding. Nothing here needs
 * Monaco at run time, so the unit tests load it in Node; Monaco's types
 * are only named.
 */
import type * as lsp from 'vscode-languageserver-protocol';
import type * as monaco from 'monaco-editor/editor/editor.api';
import { toMonacoRange } from './call-hierarchy.ts';

/** A tooltip as Monaco takes it: plain text as a string, Markdown as a Markdown string (never trusted to run commands). */
export function toTooltip(t: string | lsp.MarkupContent | undefined): string | monaco.IMarkdownString | undefined {
	if (t === undefined) return undefined;
	if (typeof t === 'string') return t;
	return t.kind === 'markdown' ? { value: t.value } : t.value;
}

/**
 * An LSP inlay hint as a Monaco one. A label made of parts keeps each
 * part's text and tooltip; a part's location and command, which Monaco
 * would make clickable, are left out (no server here sends them). The
 * kinds are numbered alike (1 a type, 2 a parameter).
 */
export function toInlayHint(h: lsp.InlayHint): monaco.languages.InlayHint {
	const label =
		typeof h.label === 'string'
			? h.label
			: h.label.map((p): monaco.languages.InlayHintLabelPart => {
					const tooltip = toTooltip(p.tooltip);
					return { label: p.value, ...(tooltip !== undefined && { tooltip }) };
				});
	const tooltip = toTooltip(h.tooltip);
	return {
		label,
		position: { lineNumber: h.position.line + 1, column: h.position.character + 1 },
		...(h.kind !== undefined && { kind: h.kind as number as monaco.languages.InlayHintKind }),
		...(tooltip !== undefined && { tooltip }),
		...(h.textEdits && { textEdits: h.textEdits.map((e) => ({ range: toMonacoRange(e.range), text: e.newText })) }),
		...(h.paddingLeft !== undefined && { paddingLeft: h.paddingLeft }),
		...(h.paddingRight !== undefined && { paddingRight: h.paddingRight }),
	};
}
