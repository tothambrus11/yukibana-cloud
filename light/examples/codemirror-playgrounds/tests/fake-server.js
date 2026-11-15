// A stand-in for the C++ pack's language server, for test.mjs where the
// pack is not installed: a module worker that speaks LSP over postMessage
// (light/packs/CONTRACT.md, "Transport") and answers from its own
// documents only, with a name of its own, so a test can tell which
// server answered in which editor.
//
// It keeps its documents by incremental sync, as clangd does, and finds
// every problem in the text it has, so a diagnostic in the wrong place
// means a change reached it wrong:
//
// - diagnostics: every `oops`, an error;
// - completion: every word of four letters or more in its documents;
// - hover: the word under the cursor and the server's name;
// - definition: the first occurrence of the word in another of its
//   documents, else in the same one;
// - formatting: trailing spaces removed.
const NAME = `fake-${Math.random().toString(36).slice(2, 8)}`;
/** Every open document's text, by URI. */
const docs = new Map();

const post = (message) => self.postMessage({ jsonrpc: '2.0', ...message });

/** The offset of an LSP position in `text`. */
function offsetOf(text, { line, character }) {
	let offset = 0;
	for (let i = 0; i < line; i += 1) {
		const next = text.indexOf('\n', offset);
		if (next < 0) return text.length;
		offset = next + 1;
	}
	return Math.min(offset + character, text.length);
}

/** The LSP position of `offset` in `text`. */
function positionOf(text, offset) {
	const before = text.slice(0, offset);
	const line = before.split('\n').length - 1;
	return { line, character: offset - (before.lastIndexOf('\n') + 1) };
}

/** The word around `offset` in `text`, and where it starts. */
function wordAt(text, offset) {
	let from = offset;
	let to = offset;
	while (from > 0 && /\w/.test(text[from - 1])) from -= 1;
	while (to < text.length && /\w/.test(text[to])) to += 1;
	return { word: text.slice(from, to), from, to };
}

function publish(uri) {
	const text = docs.get(uri) ?? '';
	const diagnostics = [...text.matchAll(/oops/g)].map((match) => ({
		range: { start: positionOf(text, match.index), end: positionOf(text, match.index + 4) },
		severity: 1,
		source: NAME,
		message: 'oops is not C++',
	}));
	post({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } });
}

const REQUESTS = {
	initialize: () => ({
		capabilities: { textDocumentSync: 2, completionProvider: { triggerCharacters: ['.'] }, hoverProvider: true, definitionProvider: true, documentFormattingProvider: true },
		serverInfo: { name: NAME },
	}),
	shutdown: () => null,
	'textDocument/completion': () => {
		const words = new Set();
		for (const text of docs.values()) for (const [word] of text.matchAll(/[A-Za-z_]\w{3,}/g)) words.add(word);
		return { isIncomplete: false, items: [...words].sort().map((label) => ({ label, kind: 6, detail: NAME })) };
	},
	'textDocument/hover': ({ textDocument, position }) => {
		const text = docs.get(textDocument.uri) ?? '';
		const { word, from, to } = wordAt(text, offsetOf(text, position));
		if (word === '') return null;
		return { contents: { kind: 'markdown', value: `**${word}**, said by ${NAME}\n\n\`\`\`cpp\n${word}\n\`\`\`` }, range: { start: positionOf(text, from), end: positionOf(text, to) } };
	},
	'textDocument/definition': ({ textDocument, position }) => {
		const text = docs.get(textDocument.uri) ?? '';
		const { word } = wordAt(text, offsetOf(text, position));
		if (word === '') return null;
		const order = [...[...docs.keys()].filter((uri) => uri !== textDocument.uri), textDocument.uri];
		for (const uri of order) {
			const other = docs.get(uri);
			const at = other.search(new RegExp(`\\b${word}\\b`));
			if (at >= 0) return [{ uri, range: { start: positionOf(other, at), end: positionOf(other, at + word.length) } }];
		}
		return null;
	},
	'textDocument/formatting': ({ textDocument }) => {
		const lines = (docs.get(textDocument.uri) ?? '').split('\n');
		return lines.flatMap((line, i) => {
			const trimmed = line.replace(/[ \t]+$/, '');
			return trimmed === line ? [] : [{ range: { start: { line: i, character: trimmed.length }, end: { line: i, character: line.length } }, newText: '' }];
		});
	},
};

const NOTIFICATIONS = {
	'textDocument/didOpen': ({ textDocument }) => {
		docs.set(textDocument.uri, textDocument.text);
		publish(textDocument.uri);
	},
	'textDocument/didChange': ({ textDocument, contentChanges }) => {
		let text = docs.get(textDocument.uri) ?? '';
		for (const change of contentChanges) {
			if (change.range === undefined) text = change.text;
			else text = text.slice(0, offsetOf(text, change.range.start)) + change.text + text.slice(offsetOf(text, change.range.end));
		}
		docs.set(textDocument.uri, text);
		publish(textDocument.uri);
	},
	'textDocument/didClose': ({ textDocument }) => docs.delete(textDocument.uri),
	exit: () => self.close(),
};

self.onmessage = ({ data }) => {
	if (typeof data !== 'object' || data === null || typeof data.method !== 'string') return;
	if (data.id === undefined) {
		NOTIFICATIONS[data.method]?.(data.params);
		return;
	}
	const handler = REQUESTS[data.method];
	if (handler === undefined) post({ id: data.id, error: { code: -32601, message: `${data.method} is not handled by ${NAME}` } });
	else post({ id: data.id, result: handler(data.params ?? {}) });
};
