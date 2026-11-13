/**
 * The page's colour scheme: the system's unless the student chose one,
 * which the browser keeps. It is `data-theme` on `<html>`, which page.css
 * reads, and Monaco's theme, which the editors follow (`dark`).
 */

/** What the student chose: the system's scheme, or one of the two. */
export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'yukibana-course/theme';

/** Reads the kept choice; `system` when there is none, it is not one, or storage refuses to be read. */
function kept(): ThemeChoice {
	try {
		const value = localStorage.getItem(KEY);
		return value === 'light' || value === 'dark' ? value : 'system';
	} catch {
		return 'system';
	}
}

/** The page's one theme. Made once, by this module; reading it in a component or effect follows its changes. */
class Theme {
	choice: ThemeChoice = $state(kept());
	#systemDark: boolean = $state(false);
	/** Whether the page is dark now. */
	readonly dark: boolean = $derived(this.choice === 'dark' || (this.choice === 'system' && this.#systemDark));

	constructor() {
		const query = matchMedia('(prefers-color-scheme: dark)');
		this.#systemDark = query.matches;
		query.addEventListener('change', (event) => (this.#systemDark = event.matches));
	}

	/** Moves to the next choice (system, light, dark), keeps it, and sets `data-theme` (none for `system`, so the media query decides). */
	cycle(): void {
		this.choice = this.choice === 'system' ? 'light' : this.choice === 'light' ? 'dark' : 'system';
		try {
			if (this.choice === 'system') localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, this.choice);
		} catch {
			// A browser that keeps nothing gets the choice for this visit only.
		}
		this.apply();
	}

	/** Sets `<html data-theme>` from the choice. */
	apply(): void {
		if (this.choice === 'system') delete document.documentElement.dataset['theme'];
		else document.documentElement.dataset['theme'] = this.choice;
	}
}

/** The page's theme. */
export const theme = new Theme();
