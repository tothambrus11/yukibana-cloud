/**
 * The textarea page: a language's entry file in a plain `<textarea>`
 * (@yukibana/editors/textarea, whose project holds the sample's other
 * files as hidden ones), and the language's server as a `LanguageSession`
 * (@yukibana/runtime) whose client is this page. The textarea adapter has
 * no language features of its own (DESIGN.md decision D10), so the page
 * draws what the server answers beside it, in plain HTML:
 *
 * - the problems list, the server's published diagnostics of every file,
 *   each a button that puts the caret on its place in the entry file;
 * - the hover, asked for where the caret stops;
 * - completion, on Ctrl+Space and after the server's trigger characters,
 *   a list chosen with the arrows and Enter or Tab, or the mouse;
 * - go to definition, F12 or its button: the place in the entry file, or
 *   the file and line of another.
 *
 * The textarea tells the session of each edit as the whole text replaced:
 * a textarea's input events say nothing of where they changed it, and the
 * session sends the server whatever kind of change it asks for.
 */
import type { Path } from '@yukibana/core';
import { textareaEditor } from '@yukibana/editors/textarea';
import type { CompletionItem, CompletionList, Diagnostic, DocumentUri, Hover, Location, LocationLink, ServerCapabilities } from '@yukibana/protocol';
import type { SessionClient } from '@yukibana/runtime';
import { chosenLanguage, languagePicker, part, sessionView } from './page.ts';
import { documentUri, languageSession, pathOfUri, whyNotStarted } from './session.ts';
import { completionItems, hoverText, insertionOf, offsetOf, positionOf, wholeRange } from './text.ts';

const language = chosenLanguage();
languagePicker(part<HTMLSelectElement>(document, '#language'), language);
const view = sessionView(part(document, '#status'), part(document, '#log'));
const textarea = part<HTMLTextAreaElement>(document, '#code');
const problemsList = part<HTMLUListElement>(document, '#problems');
const hoverPanel = part<HTMLElement>(document, '#hover');
const completionsList = part<HTMLUListElement>(document, '#completions');

const body = await language.body();
const entry: Path = language.entry;
const hidden = Object.fromEntries(Object.entries(body.sample).filter(([path]) => path !== entry));
part<HTMLElement>(document, '#file').textContent = `${entry}${Object.keys(hidden).length > 0 ? ` (and, unseen: ${Object.keys(hidden).join(', ')})` : ''}`;
textarea.value = body.sample[entry] ?? '';
textarea.disabled = false;

const editor = textareaEditor(textarea, entry, hidden);
const session = languageSession(language, body, view);
const entryUri = documentUri(entry);
/** The LSP language id of the entry file, and of the hidden files of the same language. */
const languageId = language.monacoLanguages[0] ?? language.key;

/** The entry file's text as the server last heard it, which an edit's range is of. */
let sent = textarea.value;
/** The server's diagnostics, by document, as last published. */
const diagnostics = new Map<DocumentUri, readonly Diagnostic[]>();
let capabilities: ServerCapabilities = {};

/** The textarea page as the session's client: what it can show of each feature, and what it does with the server's answers. */
const client: SessionClient = {
	capabilities: {
		textDocument: {
			synchronization: { dynamicRegistration: false },
			publishDiagnostics: { relatedInformation: false },
			hover: { contentFormat: ['plaintext', 'markdown'] },
			completion: { completionItem: { snippetSupport: false, documentationFormat: ['plaintext', 'markdown'] }, contextSupport: true },
			definition: { linkSupport: true },
		},
		workspace: { configuration: true, workspaceFolders: true },
	},
	started: (server) => {
		capabilities = server;
		// Every file of the project is open, so a server that resolves
		// imports from open documents (the hidden files) finds them.
		for (const [path, text] of Object.entries(editor.project.snapshot().files())) {
			session.open({ uri: documentUri(path), languageId: path === entry ? languageId : languageOf(path), version: 1, text }, 'existing');
		}
		sent = textarea.value;
	},
	diagnostics: (uri, list) => {
		diagnostics.set(uri, list);
		showProblems();
	},
	showDocument: () => false,
	applyEdit: () => Promise.resolve(false),
	refreshed: () => {},
	closed: () => {
		diagnostics.clear();
		showProblems();
	},
};

/** The LSP language id of a hidden file: its language's when its extension is the entry file's, else what its extension says, else plain text. */
function languageOf(path: string): string {
	const extension = (name: string): string => (name.includes('.') ? name.slice(name.lastIndexOf('.')) : '');
	if (extension(path) === extension(entry)) return languageId;
	return { '.json': 'json', '.toml': 'toml', '.md': 'markdown', '.h': 'cpp', '.mod': 'go.mod' }[extension(path)] ?? 'plaintext';
}

editor.project.onChange((change) => {
	if (change.kind !== 'edited' || !session.ready) return;
	const text = textarea.value;
	session.change(entryUri, { version: change.version, changes: [{ range: wholeRange(sent), rangeLength: sent.length, text }], text: () => text });
	sent = text;
});

const SEVERITY = ['error', 'error', 'warning', 'information', 'hint'] as const;

/** Lists the diagnostics: the entry file's first, each a button to its place; another file's named with it. */
function showProblems(): void {
	const rows = [...diagnostics].flatMap(([uri, list]) => list.map((diagnostic) => ({ uri, diagnostic }))).sort((a, b) => Number(b.uri === entryUri) - Number(a.uri === entryUri));
	problemsList.replaceChildren(
		...rows.map(({ uri, diagnostic }) => {
			const item = document.createElement('li');
			const severity = SEVERITY[diagnostic.severity ?? 1];
			item.className = `problem ${severity}`;
			const where = `${pathOfUri(uri) ?? uri}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`;
			const button = document.createElement('button');
			button.type = 'button';
			button.textContent = `${where} ${severity}: ${diagnostic.message}${diagnostic.source ? ` (${diagnostic.source})` : ''}`;
			button.disabled = uri !== entryUri;
			button.addEventListener('click', () => select(offsetOf(textarea.value, diagnostic.range.start), offsetOf(textarea.value, diagnostic.range.end)));
			item.append(button);
			return item;
		}),
	);
	part<HTMLElement>(document, '#problem-count').textContent = String(rows.length);
}

/** Selects `from` to `to` in the textarea and scrolls it into view. */
function select(from: number, to: number): void {
	textarea.focus();
	textarea.setSelectionRange(from, to);
	// A textarea scrolls to its caret only when it gets text; this puts the
	// selected line in view, a line height per line before it.
	const line = positionOf(textarea.value, from).line;
	textarea.scrollTop = Math.max(0, line * parseFloat(getComputedStyle(textarea).lineHeight || '20') - textarea.clientHeight / 3);
}

/** The position of the caret, as the server counts. */
const caret = () => positionOf(textarea.value, textarea.selectionStart);
const textDocument = { uri: entryUri };

// ---- Hover: asked where the caret stops ---------------------------------

let hoverAsk: AbortController | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
function askHover(): void {
	clearTimeout(hoverTimer);
	hoverTimer = setTimeout(async () => {
		if (!capabilities.hoverProvider) return;
		hoverAsk?.abort();
		const ask = (hoverAsk = new AbortController());
		const at = caret();
		const hover = await session.ask<Hover>('textDocument/hover', { textDocument, position: at }, ask.signal);
		if (ask.signal.aborted) return;
		const text = hoverText(hover);
		hoverPanel.textContent = text === null ? `Nothing to show at line ${at.line + 1}, column ${at.character + 1}.` : text;
	}, 300);
}
for (const event of ['click', 'keyup', 'select']) textarea.addEventListener(event, askHover);

// ---- Completion ----------------------------------------------------------

let completion: { readonly items: readonly CompletionItem[]; readonly defaults: CompletionList['itemDefaults']; chosen: number } | null = null;
let completionAsk: AbortController | null = null;

async function complete(trigger: { readonly kind: 1 } | { readonly kind: 2; readonly character: string }): Promise<void> {
	if (!capabilities.completionProvider) return;
	completionAsk?.abort();
	const ask = (completionAsk = new AbortController());
	const context = trigger.kind === 1 ? { triggerKind: 1 } : { triggerKind: 2, triggerCharacter: trigger.character };
	const answer = await session.ask<CompletionList | CompletionItem[]>('textDocument/completion', { textDocument, position: caret(), context }, ask.signal);
	if (ask.signal.aborted) return;
	const items = completionItems(answer).slice(0, 100);
	completion = items.length > 0 ? { items, defaults: answer !== null && !Array.isArray(answer) ? (answer as CompletionList).itemDefaults : undefined, chosen: 0 } : null;
	showCompletions();
}

function showCompletions(): void {
	completionsList.hidden = completion === null;
	completionsList.replaceChildren(
		...(completion?.items ?? []).map((item, index) => {
			const row = document.createElement('li');
			row.setAttribute('role', 'option');
			row.setAttribute('aria-selected', String(index === completion?.chosen));
			row.textContent = item.label;
			if (item.detail) {
				const detail = document.createElement('span');
				detail.className = 'detail';
				detail.textContent = item.detail;
				row.append(detail);
			}
			row.addEventListener('mousedown', (event) => {
				event.preventDefault();
				accept(index);
			});
			return row;
		}),
	);
	completionsList.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

/** Accepts completion `index`: its text in place, told to the project (and so the server) as any typing is. */
function accept(index: number): void {
	const item = completion?.items[index];
	const defaults = completion?.defaults;
	completion = null;
	showCompletions();
	if (item === undefined) return;
	const change = insertionOf(item, textarea.value, textarea.selectionStart, defaults);
	textarea.setRangeText(change.insert, change.from, change.to, 'end');
	textarea.setSelectionRange(change.caret, change.caret);
	// setRangeText fires no input event, which is what the adapter listens to.
	textarea.dispatchEvent(new Event('input'));
	textarea.focus();
}

textarea.addEventListener('keydown', (event) => {
	if (completion !== null) {
		const count = completion.items.length;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			completion.chosen = (completion.chosen + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
			showCompletions();
			event.preventDefault();
			return;
		}
		if (event.key === 'Enter' || event.key === 'Tab') {
			accept(completion.chosen);
			event.preventDefault();
			return;
		}
		if (event.key === 'Escape') {
			completion = null;
			showCompletions();
			event.preventDefault();
			return;
		}
	}
	if (event.key === ' ' && event.ctrlKey) {
		event.preventDefault();
		void complete({ kind: 1 });
	} else if (event.key === 'F12') {
		event.preventDefault();
		void goToDefinition();
	}
});
textarea.addEventListener('input', (event) => {
	const typed = event instanceof InputEvent ? event.data : null;
	const triggers = capabilities.completionProvider?.triggerCharacters ?? [];
	if (typed !== null && typed.length === 1 && triggers.includes(typed)) void complete({ kind: 2, character: typed });
	else if (completion !== null) void complete({ kind: 1 }); // the list follows the word as it grows
});
textarea.addEventListener('blur', () => {
	completion = null;
	showCompletions();
});
part<HTMLButtonElement>(document, '#complete').addEventListener('click', () => {
	textarea.focus();
	void complete({ kind: 1 });
});

// ---- Go to definition ----------------------------------------------------

async function goToDefinition(): Promise<void> {
	const answer = await session.ask<Location | readonly Location[] | readonly LocationLink[]>('textDocument/definition', { textDocument, position: caret() }, new AbortController().signal);
	const first: Location | LocationLink | null | undefined = Array.isArray(answer) ? answer[0] : (answer as Location | null);
	if (first === null || first === undefined) {
		hoverPanel.textContent = 'No definition found here.';
		return;
	}
	const uri = 'targetUri' in first ? first.targetUri : first.uri;
	const range = 'targetUri' in first ? first.targetSelectionRange : first.range;
	if (uri === entryUri) {
		select(offsetOf(textarea.value, range.start), offsetOf(textarea.value, range.end));
		return;
	}
	const path = pathOfUri(uri);
	const text = path === null ? undefined : hidden[path];
	const line = text?.split('\n')[range.start.line]?.trim();
	hoverPanel.textContent = `Defined in ${path ?? uri}, line ${range.start.line + 1}${line ? `:\n\n${line}` : '.'}`;
}
part<HTMLButtonElement>(document, '#definition').addEventListener('click', () => void goToDefinition());

// ---- The session ---------------------------------------------------------

view.log('info', `Starting the ${language.label} language server (packs/${language.pack}/server.js).`);
session.start(client).then(
	() => {
		view.log('info', 'The server is ready: move the caret onto a name, press Ctrl+Space, F12, or break something and watch the problems.');
		askHover();
	},
	async (error: unknown) => {
		const why = await whyNotStarted(language, error);
		view.status(why);
		view.log('error', why);
	},
);
addEventListener('pagehide', () => void session.stop());
