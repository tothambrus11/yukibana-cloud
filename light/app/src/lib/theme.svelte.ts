/**
 * Light and dark themes. The page's colours are CSS variables keyed on
 * `<html data-theme>`; Monaco needs its own theme objects, defined here with
 * the same palette, every text colour at least 7:1 against the editor
 * (palette.ts).
 *
 * The choice is System, Light or Dark. System follows the system's scheme,
 * live: switching the system between light and dark switches the page and
 * the editors at once. It is remembered under KEY in localStorage, as
 * 'light' or 'dark' (what the key held before System existed, read the same
 * way); System is the key's absence.
 *
 * The page is never drawn in the wrong scheme first: an inline script in
 * app.html sets `<html data-theme>` from the same key, or from the system,
 * before the first paint. It repeats `resolve` below; the two must agree.
 *
 * Importing this module changes nothing on the page: `theme.start()`, after
 * `startEditor` (monaco.ts), defines the editor's themes and applies the
 * remembered one.
 */
import { monaco } from './monaco';
import { internals } from './monaco-internals';
import { EDITOR, LINE_NUMBERS, OWN_RULES, raise, raisedRules, TEXT_CONTRAST, viewText, type Hex, type Theme } from './palette';

export type { Theme };

/** What the user chose: a theme, or 'system' to follow the system's scheme. */
export type ThemeChoice = 'system' | Theme;

/** The choices in the order the theme button cycles through them. */
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/** How each choice is named in the bar and the menu. */
export const THEME_NAMES: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/** Also read by the inline script in app.html, which must name the same key. */
const KEY = 'yukibana.code.theme';

/**
 * Every token rule of a theme, Monaco's underneath the theme's own, with
 * each colour raised to TEXT_CONTRAST (palette.ts says why). Monaco's rules
 * are repeated rather than inherited so that the ones below the contrast
 * (vs-dark's registers, `variable.predefined`, at 3.3:1) are raised too.
 */
export const THEME_RULES: Record<Theme, monaco.editor.ITokenThemeRule[]> = {
	dark: raisedRules(internals.themeRules.dark, OWN_RULES.dark, EDITOR.dark.background),
	light: raisedRules(internals.themeRules.light, OWN_RULES.light, EDITOR.light.background),
};

/** The line numbers, raised like the tokens. */
const lineNumbers = (theme: Theme) => ({
	'editorLineNumber.foreground': raise(LINE_NUMBERS[theme].normal, EDITOR[theme].background, TEXT_CONTRAST),
	'editorLineNumber.activeForeground': raise(LINE_NUMBERS[theme].active, EDITOR[theme].caretLine, TEXT_CONTRAST),
});

/** Every text colour the linked views can draw on a tinted row, per theme (link-colours.ts checks the tints against them). */
export const VIEW_TEXT: Record<Theme, Hex[]> = {
	dark: viewText(THEME_RULES.dark, lineNumbers('dark')),
	light: viewText(THEME_RULES.light, lineNumbers('light')),
};

/**
 * Defines the two editor themes with the page's Monaco; `theme.start()` does,
 * once. The widgets' colours are the design system's tokens
 * (@yukibana/design/tokens.css) as hex: `--yk-surface` and `--yk-line` for widgets,
 * `--yk-ink` for the cursor, the focus border (the ink ring's colour) and the
 * chosen suggestion's text, `--yk-info` for its matched letters and faintly
 * for the selection. Green, the accent, is kept for actions, links and the
 * current tab's line.
 *
 * The chosen suggestion's fill is `--yk-info`'s hue a step darker than
 * `--yk-info-bg` (oklch 91% 0.04 245 light, 30% 0.05 245 dark): `--yk-info-bg`
 * itself is 1.14:1 against the widget and the row is hard to find. The fill is
 * 1.3:1 against the widget; on it the ink is 13:1 (light) and 11:1 (dark), the
 * matched letters 4.6:1 and 7.4:1. Monaco's own text there is white, which
 * on a light fill cannot be read, so both themes set it.
 */
function defineThemes(): void {
	monaco.editor.defineTheme('yukibana-dark', {
		base: 'vs-dark',
		inherit: true,
		rules: THEME_RULES.dark,
		colors: {
			'editor.background': EDITOR.dark.background,
			'editor.lineHighlightBackground': EDITOR.dark.caretLine,
			...lineNumbers('dark'),
			'editorGutter.background': EDITOR.dark.background,
			'editorWidget.background': '#12161d',
			'editorWidget.border': '#262c34',
			'editorHoverWidget.background': '#12161d',
			'editorHoverWidget.border': '#262c34',
			'editorSuggestWidget.background': '#12161d',
			'editorSuggestWidget.border': '#262c34',
			'editorSuggestWidget.selectedBackground': '#163045',
			'editorSuggestWidget.selectedForeground': '#e8ebf0',
			'editorSuggestWidget.selectedIconForeground': '#e8ebf0',
			'editorSuggestWidget.focusHighlightForeground': '#87c6f2',
			'list.hoverBackground': '#1d222a',
			focusBorder: '#e8ebf0',
			'editorCursor.foreground': '#e8ebf0',
			'editor.selectionBackground': '#87c6f240',
		},
	});

	monaco.editor.defineTheme('yukibana-light', {
		base: 'vs',
		inherit: true,
		rules: THEME_RULES.light,
		colors: {
			'editor.background': EDITOR.light.background,
			'editor.lineHighlightBackground': EDITOR.light.caretLine,
			...lineNumbers('light'),
			'editorGutter.background': EDITOR.light.background,
			'editorWidget.background': '#ffffff',
			'editorWidget.border': '#dadee4',
			'editorHoverWidget.background': '#ffffff',
			'editorHoverWidget.border': '#dadee4',
			'editorSuggestWidget.background': '#ffffff',
			'editorSuggestWidget.border': '#dadee4',
			'editorSuggestWidget.selectedBackground': '#cce5fb',
			'editorSuggestWidget.selectedForeground': '#141b25',
			'editorSuggestWidget.selectedIconForeground': '#141b25',
			'editorSuggestWidget.focusHighlightForeground': '#1f689d',
			'list.hoverBackground': '#ebeef3',
			focusBorder: '#141b25',
			'editorCursor.foreground': '#141b25',
			'editor.selectionBackground': '#1f689d33',
		},
	});
}

/** The remembered choice: 'light' or 'dark' as stored, System for anything else (nothing stored, or storage disabled). */
function remembered(): ThemeChoice {
	try {
		const saved = localStorage.getItem(KEY);
		if (saved === 'light' || saved === 'dark') return saved;
	} catch {
		// Storage disabled: follow the system.
	}
	return 'system';
}

/** The system's scheme, as a media query that reports its changes. */
const SYSTEM_LIGHT = '(prefers-color-scheme: light)';

/** The theme a choice shows while the system's scheme is light (`systemLight`) or not. Dark when the system says neither. */
export const resolve = (choice: ThemeChoice, systemLight: boolean): Theme => (choice === 'system' ? (systemLight ? 'light' : 'dark') : choice);

/** The theme; set `choice` to change it everywhere. `current` is the theme shown. */
class ThemeState {
	#choice = $state<ThemeChoice>(remembered());
	#systemLight = $state(matchMedia(SYSTEM_LIGHT).matches);
	#started = false;

	/**
	 * Defines the editor's themes and applies the current one to the page
	 * (`<html data-theme>`, the editors, the title bar's colour). Call it
	 * once, after `startEditor`, since setting Monaco's theme starts its
	 * services; a second call does nothing. Until then, setting `choice`
	 * only remembers it. From then on it also follows the system's scheme,
	 * listening here rather than on import, so that importing this module
	 * still changes nothing (tests/unit/editor-start.test.mjs).
	 */
	start(): void {
		if (this.#started) return;
		this.#started = true;
		defineThemes();
		// Live from here on: a change of the system's scheme reaches the page and the editors while System is chosen.
		const system = matchMedia(SYSTEM_LIGHT);
		this.#systemLight = system.matches;
		system.addEventListener('change', (e) => {
			this.#systemLight = e.matches;
			if (this.#choice === 'system') this.apply();
		});
		this.apply();
	}

	/** The theme shown: the chosen one, or the system's while System is chosen. */
	get current(): Theme {
		return resolve(this.#choice, this.#systemLight);
	}

	get choice(): ThemeChoice {
		return this.#choice;
	}

	set choice(choice: ThemeChoice) {
		this.#choice = choice;
		try {
			if (choice === 'system') localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, choice);
		} catch {
			// Not remembered; still applied.
		}
		if (this.#started) this.apply();
	}

	/** The choice after the current one, in THEME_CHOICES' order: System, Light, Dark, System again. */
	get next(): ThemeChoice {
		return THEME_CHOICES[(THEME_CHOICES.indexOf(this.#choice) + 1) % THEME_CHOICES.length] ?? 'system';
	}

	/** Moves to the next choice (the theme button). */
	cycle(): void {
		this.choice = this.next;
	}

	private apply(): void {
		const theme = this.current;
		document.documentElement.dataset['theme'] = theme;
		monaco.editor.setTheme(`yukibana-${theme}`);
		// The installed app's title bar, `--yk-bg` as the top bar is. app.html gives one per system scheme; set to the theme
		// shown, both always agree with the page (System included, which this follows as it changes).
		for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = theme === 'dark' ? '#0b0e15' : '#f5f7fa';
	}
}

export const theme = new ThemeState();
