/** Where the person looking at the page is, as far as times go.
 *
 *  `zone` is UTC while the page is rendered by the Worker and hydrated, and
 *  the browser's own zone from the moment the root layout mounts. Pages
 *  read it when they write a time, so every time on screen is rewritten in
 *  the browser's zone as soon as the browser can say what that is. Reading
 *  it rather than asking the runtime is the point: the Worker's answer is
 *  UTC, and Svelte keeps server-rendered text it does not know has changed,
 *  so a time written from the runtime's zone stayed in UTC on a first load
 *  and was in the browser's zone after a navigation.
 *
 *  The server never writes it, so the one copy a Worker shares between
 *  requests stays UTC. */
export const viewer = $state({ zone: 'UTC' });
