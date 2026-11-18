/**
 * The page's colour scheme: the system's, or one the reader picked, kept
 * in this browser only (localStorage, a convenience that may be missing in
 * a private window). The page's CSS reads `data-theme` on <html>; the
 * editors read `useScheme()`.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

/** What the reader chose. */
export type ThemeChoice = 'system' | 'light' | 'dark';
/** What is shown. */
export type Scheme = 'light' | 'dark';

const KEY = 'react-explorer:theme';

function saved(): ThemeChoice {
	try {
		const value = localStorage.getItem(KEY);
		return value === 'light' || value === 'dark' ? value : 'system';
	} catch {
		return 'system';
	}
}

function save(choice: ThemeChoice): void {
	try {
		if (choice === 'system') localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, choice);
	} catch {
		// Nothing to keep it in; the choice lasts for the page.
	}
}

const DARK = '(prefers-color-scheme: dark)';

function systemScheme(): Scheme {
	return matchMedia(DARK).matches ? 'dark' : 'light';
}

interface ThemeValue {
	readonly choice: ThemeChoice;
	readonly scheme: Scheme;
	readonly choose: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeValue>({ choice: 'system', scheme: 'light', choose: () => {} });

/** Holds the reader's choice and puts it on <html> as `data-theme` (absent for the system's). */
export function ThemeProvider({ children }: { readonly children: ReactNode }): ReactNode {
	const [choice, setChoice] = useState<ThemeChoice>(saved);
	const system = useSyncExternalStore(
		(changed) => {
			const query = matchMedia(DARK);
			query.addEventListener('change', changed);
			return () => query.removeEventListener('change', changed);
		},
		systemScheme,
	);
	useEffect(() => {
		if (choice === 'system') delete document.documentElement.dataset['theme'];
		else document.documentElement.dataset['theme'] = choice;
		save(choice);
	}, [choice]);
	const scheme: Scheme = choice === 'system' ? system : choice;
	return <ThemeContext value={{ choice, scheme, choose: setChoice }}>{children}</ThemeContext>;
}

/** Returns the scheme shown, the reader's choice and how to change it. */
export function useTheme(): ThemeValue {
	return useContext(ThemeContext);
}
