/**
 * Light and dark themes. The page's colours are CSS variables keyed on
 * `<html data-theme>`; Monaco needs its own theme objects, defined here with
 * the same palette, every text colour at least 7:1 against the editor
 * (palette.ts). The choice follows the system until the user toggles it.
 *
 * Importing this module changes nothing on the page: `theme.start()`, after
 * `startEditor` (monaco.ts), defines the editor's themes and applies the
 * remembered one.
 */
import { monaco } from './monaco';
import { internals } from './monaco-internals';
import { EDITOR, LINE_NUMBERS, OWN_RULES, raise, raisedRules, TEXT_CONTRAST, viewText, type Hex, type Theme } from './palette';

export type { Theme };

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
 * (design/tokens.css) as hex: `--yk-surface` and `--yk-line` for widgets,
 * `--yk-info-bg` for the chosen suggestion, `--yk-ink` for the cursor and the
 * focus border (the ink ring's colour), `--yk-info` faintly for the
 * selection. Green, the accent, is kept for actions, links and the current
 * tab's line.
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
			'editorSuggestWidget.selectedBackground': '#152839',
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
			'editorSuggestWidget.selectedBackground': '#e6f2fd',
			'list.hoverBackground': '#ebeef3',
			focusBorder: '#141b25',
			'editorCursor.foreground': '#141b25',
			'editor.selectionBackground': '#1f689d33',
		},
	});
}

function initial(): Theme {
	try {
		const saved = localStorage.getItem(KEY);
		if (saved === 'light' || saved === 'dark') return saved;
	} catch {
		// Storage disabled: follow the system.
	}
	return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** The current theme; set `current` to change it everywhere. */
class ThemeState {
	#current = $state<Theme>(initial());
	#started = false;

	/**
	 * Defines the editor's themes and applies the current one to the page
	 * (`<html data-theme>`, the editors, the title bar's colour). Call it
	 * once, after `startEditor`, since setting Monaco's theme starts its
	 * services; a second call does nothing. Until then, setting `current`
	 * only remembers the choice.
	 */
	start(): void {
		if (this.#started) return;
		this.#started = true;
		defineThemes();
		this.apply();
	}

	get current(): Theme {
		return this.#current;
	}

	set current(theme: Theme) {
		this.#current = theme;
		try {
			localStorage.setItem(KEY, theme);
		} catch {
			// Not remembered; still applied.
		}
		if (this.#started) this.apply();
	}

	toggle(): void {
		this.current = this.#current === 'dark' ? 'light' : 'dark';
	}

	private apply(): void {
		document.documentElement.dataset['theme'] = this.#current;
		monaco.editor.setTheme(`yukibana-${this.#current}`);
		// The installed app's title bar, `--yk-bg` as the top bar is: app.html picks by system theme; a toggle overrides both.
		for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = this.#current === 'dark' ? '#0b0e15' : '#f5f7fa';
	}
}

export const theme = new ThemeState();
