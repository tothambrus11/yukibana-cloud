/** Which tab of a page is showing.
 *
 *  A tab is a query parameter (`?tab=roster`), not client state: a link to a
 *  tab is a link, the page works without JavaScript, and a form inside a tab
 *  posts to `?tab=roster&/enrol`, so the answer to the form lands on the tab
 *  it was sent from. SvelteKit finds the action by the parameter that
 *  starts with `/`, wherever it is in the query.
 */

export interface Tab {
  readonly id: string;
  readonly label: string;
  /** Shown beside the label, like a number of submissions. */
  readonly count?: number;
}

/** The tab `url` asks for, if this person has it, else the first. Only the
 *  query is read, so SvelteKit's read-only `page.url` will do. A tab the
 *  person does not have (a student given `?tab=tokens`) is never shown: it
 *  falls back rather than rendering an empty or forbidden section. */
export function tabOf(url: { readonly searchParams: { get(name: string): string | null } }, tabs: readonly Tab[]): string {
  const asked = url.searchParams.get('tab');
  return tabs.find((t) => t.id === asked)?.id ?? tabs[0]?.id ?? '';
}

/** The action URL for a form inside tab `tab`. */
export const actionIn = (tab: string, action: string): string => `?tab=${encodeURIComponent(tab)}&/${action}`;
