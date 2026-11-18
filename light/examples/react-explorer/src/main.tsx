/**
 * The page: one host for the whole article (std's `PackHost`: one runner
 * pool, one set of explorer workers, the packs under ./packs/), handed to
 * every widget by `YukibanaProvider`. The host is kept in
 * `globalThis.reactExplorer` for the end-to-end test (test.mjs), which
 * counts the page's workers through it.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Article } from './article/Article.tsx';
import './page.css';
import { ThemeProvider } from './theme.tsx';
import { YukibanaProvider } from './yukibana/context.tsx';
import { PageHost } from './yukibana/host.ts';

declare global {
	/** The page's host (main.tsx), for the end-to-end test. */
	var reactExplorer: { readonly host: PageHost } | undefined;
}

const host = new PageHost(new URL('packs/', document.baseURI));
globalThis.reactExplorer = { host };

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root');
createRoot(root).render(
	<StrictMode>
		<ThemeProvider>
			<YukibanaProvider host={host}>
				<Article />
			</YukibanaProvider>
		</ThemeProvider>
	</StrictMode>,
);
