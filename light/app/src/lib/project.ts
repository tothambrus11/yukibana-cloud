/**
 * A project is the set of files of one language. A tab's project lives in
 * its URL (project-link.ts), so each tab has its own and reopening the
 * browser restores each as it was. Each language's project is also kept in
 * `sessionStorage`, which is the tab's own, so switching language and back
 * in a tab finds its files as they were left, and in `localStorage`, so a
 * new tab opened without a project in its URL starts from the last one
 * saved.
 */
import { isLanguageId, languageOf, type Files, type LanguageId } from './languages';
import type { RunOptions } from './cpp-targets';
import type { MiriTarget } from './rust-targets';
import { savedLevelOf } from './optimization';
import { pathProblem, workspaceRoot } from '@yukibana/runtime';
import { decodeProject, encodeProject, readDocument, type ProjectDocument } from './project-link';

/** What is saved for one language. Paths are relative, `/`-separated, without `.` or `..`. */
export interface Project {
	files: Files;
	/** Folders, including empty ones; a file's parent folders are implied and need not be listed. */
	folders: string[];
	/** Files open in editor tabs, in tab order. */
	open: string[];
	/** The file shown last. */
	active: string | null;
	/**
	 * How Run runs a C++ program built for a Linux target (cpp-targets.ts):
	 * absent until the user changes one, and then saved with the project.
	 * Other languages and the WebAssembly target ignore it.
	 */
	runOptions?: RunOptions;
	/**
	 * The optimisation level chosen for a language whose level no project
	 * file holds (optimization.ts: Swift), as its flag: absent until the user
	 * chooses one. A C or C++ project's level is its compile_flags.txt's.
	 */
	optimization?: string;
	/**
	 * false when clang-tidy is turned off for a C or C++ project: absent
	 * (it runs) until the user turns it off. Its rules are the project's
	 * .clang-tidy either way; other languages ignore it.
	 */
	clangTidy?: false;
	/**
	 * The Miri target a Rust project runs and tests under (packs/rust
	 * README, "Miri"), which checks for undefined behaviour and lays types
	 * out as that target does: absent (the program is compiled and run)
	 * until the user turns it on. Other languages ignore it.
	 */
	miri?: MiriTarget['id'];
}

/**
 * The app's one workspace: every project file lives under this folder, as
 * the language servers and the editor see it. A value rather than a
 * constant spelled out in each module, so the URIs a file has and the path
 * a URI names are decided in one place (@yukibana/runtime, paths.ts), the
 * same one a page of many snippets uses with a root per snippet.
 */
export const WORKSPACE = workspaceRoot('file:///workspace/');

const VERSION = 1;
const key = (language: LanguageId) => `yukibana.code.v${VERSION}.project.${language}`;
const LANGUAGE_KEY = `yukibana.code.v${VERSION}.language`;
/** In the tab's own storage: which language's project the tab saved last, and the URL fragment it had then (`TabNote`). */
const TAB_KEY = `yukibana.code.v${VERSION}.tab`;

/**
 * What a tab notes each time it saves: its language, and its URL's
 * fragment at that moment, which is the project as it was *before* this
 * save. The URL is written after the save, asynchronously (compressing is
 * a stream), so a save made as the page goes away (a reload, the browser
 * closing) may never reach the URL; the tab's own storage does survive
 * both. When the tab comes back with this same fragment, what it saved is
 * newer than its URL. With any other fragment, the URL was changed since
 * (a link was opened in the tab, or a later save reached the URL), and the
 * URL is the project.
 */
interface TabNote {
	language: LanguageId;
	hash: string;
}

/** A fresh copy of the language's sample project. */
export function sampleProject(language: LanguageId): Project {
	const l = languageOf(language);
	return { files: { ...l.sample }, folders: [], open: [l.entry], active: l.entry };
}

/** The tab's own store and the browser's, in the order a project is looked for. */
function stores(): [string, Storage][] {
	return [
		['tab', sessionStorage],
		['browser', localStorage],
	];
}

/**
 * The saved project for a language: this tab's, else the last saved in any
 * tab, else the sample. What is saved but cannot be read is reported, not
 * silently replaced, and the next place is looked in.
 */
export function loadProject(language: LanguageId, report: (message: string) => void): Project {
	for (const [where, store] of stores()) {
		let raw: string | null;
		try {
			raw = store.getItem(key(language));
		} catch (e) {
			report(`could not read the saved project: ${String(e)}`);
			continue;
		}
		if (raw === null) continue;
		try {
			return projectOf(readDocument(JSON.parse(raw) as unknown, { language }), language);
		} catch (e) {
			report(`the ${language} project saved in the ${where} is unreadable${where === 'browser' ? ' and was replaced by the sample' : ''}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	return sampleProject(language);
}

/**
 * Saves a project in this tab and, when `browser` is set, for the next new
 * tab; a full or unavailable storage is reported. The URL is the caller's
 * (`linkOf`).
 */
export function saveProject(language: LanguageId, project: Project, { browser }: { browser: boolean }, report: (message: string) => void): void {
	const json = JSON.stringify(documentOf(language, project));
	for (const [where, store] of stores()) {
		if (where === 'browser' && !browser) continue;
		try {
			store.setItem(key(language), json);
			if (where === 'tab') store.setItem(TAB_KEY, JSON.stringify({ language, hash: location.hash } satisfies TabNote));
		} catch (e) {
			report(`could not save the project: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
	}
}

/**
 * The project this tab saved last, when it is newer than what its URL
 * fragment `hash` holds (`TabNote` says when); null otherwise, and then
 * the URL, or with none the saved project of the language chosen last, is
 * the tab's.
 */
export function tabProject(hash: string): { language: LanguageId; project: Project } | null {
	try {
		const raw = sessionStorage.getItem(TAB_KEY);
		const note = raw === null ? null : (JSON.parse(raw) as Partial<TabNote>);
		if (!note || note.hash !== hash || !isLanguageId(note.language)) return null;
		const saved = sessionStorage.getItem(key(note.language));
		if (saved === null) return null;
		return { language: note.language, project: projectOf(readDocument(JSON.parse(saved) as unknown, { language: note.language }), note.language) };
	} catch {
		return null; // unreadable: the URL is the project, as it would be without the note
	}
}

/** The language chosen last, if any. */
export function loadLanguage(): string | null {
	try {
		return localStorage.getItem(LANGUAGE_KEY);
	} catch {
		return null;
	}
}

/** Remembers the chosen language; failure only means the choice is not remembered. */
export function saveLanguage(language: LanguageId): void {
	try {
		localStorage.setItem(LANGUAGE_KEY, language);
	} catch {
		// Storage disabled: the next visit starts with the default language.
	}
}

/** The URL fragment that holds `project`, with its `#` (project-link.ts). */
export function linkOf(language: LanguageId, project: Project): Promise<string> {
	return encodeProject(documentOf(language, project));
}

/**
 * The language and project a URL fragment holds. Throws, saying why, for a
 * damaged link or one that is not a project (`holdsProject` says whether a
 * fragment is meant to be one).
 */
export async function projectOfLink(hash: string): Promise<{ language: LanguageId; project: Project }> {
	const document = await decodeProject(hash);
	const language = document.language as LanguageId; // readDocument checked it
	return { language, project: projectOf(document, language) };
}

/** A project as the current schema writes it; what was left at its default is left out. */
function documentOf(language: LanguageId, project: Project): ProjectDocument {
	return {
		v: 3,
		language,
		files: project.files,
		...(project.folders.length ? { folders: project.folders } : {}),
		open: project.open,
		active: project.active,
		...(project.runOptions ? { runOptions: project.runOptions } : {}),
		...(project.optimization !== undefined ? { optimization: project.optimization } : {}),
		...(project.clangTidy === false ? { clangTidy: false } : {}),
		...(project.miri !== undefined ? { miri: project.miri } : {}),
	};
}

/**
 * A validated document as a project. Only the files are worth refusing a
 * project over (a path no file system takes throws, naming it): a tab, a
 * folder or the active file naming no file of it, or an optimisation level
 * the language does not have, is dropped, never thrown.
 */
function projectOf(document: ProjectDocument, language: LanguageId): Project {
	for (const path of Object.keys(document.files)) {
		const problem = pathProblem(path);
		if (problem) throw new Error(`bad path ${JSON.stringify(path)}: ${problem}`);
	}
	const files: Files = { ...document.files };
	const active = document.active ?? null;
	return {
		files,
		folders: (document.folders ?? []).filter((f) => !pathProblem(f)),
		open: (document.open ?? []).filter((p) => p in files),
		active: active !== null && active in files ? active : null,
		...(document.runOptions ? { runOptions: { ...document.runOptions } } : {}),
		...(savedLevelOf(language, document.optimization) !== null ? { optimization: document.optimization as string } : {}),
		...(document.clangTidy === false ? { clangTidy: false as const } : {}),
		...(document.miri !== undefined ? { miri: document.miri } : {}),
	};
}
