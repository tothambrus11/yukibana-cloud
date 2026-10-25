/**
 * A project is the set of files of one language, saved in `localStorage`
 * under its language, so switching language switches project and switching
 * back finds the files as they were left.
 */
import { isLanguageId, languageOf, type Files, type LanguageId } from './languages';
import { runOptionsOf, type RunOptions } from './cpp-targets';
import { savedLevelOf } from './optimization';
import { pathProblem, workspaceRoot } from '@yukibana/runtime';

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

/** The language whose project a storage key holds, or `null` for any other key. */
export function projectLanguageOf(storageKey: string): LanguageId | null {
	const prefix = key('python').replace(/python$/, '');
	const rest = storageKey.startsWith(prefix) ? storageKey.slice(prefix.length) : null;
	return rest !== null && isLanguageId(rest) ? rest : null;
}

/** A fresh copy of the language's sample project. */
export function sampleProject(language: LanguageId): Project {
	const l = languageOf(language);
	return { files: { ...l.sample }, folders: [], open: [l.entry], active: l.entry };
}

/**
 * The saved project for a language, or the sample when nothing is saved or
 * what is saved cannot be read (which is reported, not silently replaced).
 */
export function loadProject(language: LanguageId, report: (message: string) => void): Project {
	let raw: string | null;
	try {
		raw = localStorage.getItem(key(language));
	} catch (e) {
		report(`could not read the saved project: ${String(e)}`);
		return sampleProject(language);
	}
	if (raw === null) return sampleProject(language);
	try {
		return parseProject(JSON.parse(raw) as unknown, language);
	} catch (e) {
		report(`the saved ${language} project is unreadable and was replaced by the sample: ${e instanceof Error ? e.message : String(e)}`);
		return sampleProject(language);
	}
}

/** Saves a project; a full or unavailable storage is reported. */
export function saveProject(language: LanguageId, project: Project, report: (message: string) => void): void {
	try {
		localStorage.setItem(key(language), JSON.stringify(project));
	} catch (e) {
		report(`could not save the project: ${e instanceof Error ? e.message : String(e)}`);
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

/**
 * Checks the shape of a stored project; throws naming what is wrong. Only
 * the files are worth refusing a project over: a bad folder, tab, run
 * option or optimisation level is dropped (the run options to their
 * defaults, the level to the language's default), never thrown.
 */
function parseProject(value: unknown, language: LanguageId): Project {
	if (typeof value !== 'object' || value === null) throw new Error('not an object');
	const v = value as Record<string, unknown>;
	const files = v['files'];
	if (typeof files !== 'object' || files === null) throw new Error('no files');
	const checked: Files = {};
	for (const [path, text] of Object.entries(files)) {
		if (typeof text !== 'string') throw new Error(`file ${path} is not text`);
		if (pathProblem(path)) throw new Error(`bad path ${path}`);
		checked[path] = text;
	}
	const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
	const active = typeof v['active'] === 'string' && v['active'] in checked ? v['active'] : null;
	return {
		files: checked,
		folders: strings(v['folders']).filter((f) => !pathProblem(f)),
		open: strings(v['open']).filter((p) => p in checked),
		active,
		// Invalid values become the defaults: run options are not worth losing a project over.
		...(v['runOptions'] !== undefined ? { runOptions: runOptionsOf(v['runOptions']) } : {}),
		// A level this language does not have is the default's: dropped.
		...(savedLevelOf(language, v['optimization']) !== null ? { optimization: v['optimization'] as string } : {}),
	};
}
