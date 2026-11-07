/**
 * The page's host, handed down to every widget: one runner pool and one
 * set of explorer workers for the whole article, however many widgets and
 * instances it has.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { PageHost } from './host.ts';

const HostContext = createContext<PageHost | null>(null);

/** Makes `host` the host of every hook below it. */
export function YukibanaProvider({ host, children }: { readonly host: PageHost; readonly children: ReactNode }): ReactNode {
	return <HostContext value={host}>{children}</HostContext>;
}

/**
 * Returns the host of the nearest `YukibanaProvider`.
 *
 * - Requires: the component is rendered under one; otherwise it throws,
 *   naming the mistake, rather than making a second pool.
 */
export function useHost(): PageHost {
	const host = useContext(HostContext);
	if (host === null) throw new Error('A Yukibana hook was used outside <YukibanaProvider>: the page has no host to lend it.');
	return host;
}
