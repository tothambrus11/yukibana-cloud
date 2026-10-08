/** Live pages: reload what is on screen when the database says it changed.
 *
 *  The database broadcasts "something changed" on private Realtime topics
 *  (see topics.ts); this module listens to the ones the layout names and,
 *  on hearing one, reruns the page's loads with `invalidateAll`. Nothing
 *  arrives over Realtime but the news itself: the data comes from the
 *  Worker, as the person, under the same policies as the first load.
 *
 *  A page that is in the middle of something it would lose to a reload (a
 *  drag, a move still being saved, a form being edited) takes a `hold`.
 *  While any hold is taken, news is kept rather than acted on, and `live`
 *  says so; the last release reloads once.
 *
 *  Browser only. The session is the one @supabase/ssr keeps in cookies,
 *  readable by the page on purpose; supabase-js passes its access token to
 *  Realtime and renews it as it refreshes.
 */

import { createBrowserClient } from '@supabase/ssr';
import { REALTIME_SUBSCRIBE_STATES, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { invalidateAll } from '$app/navigation';
import { report } from './report';

/** What a page may show about the live connection. `stale` is true while
 *  news has arrived that a hold kept from being shown: what is on screen is
 *  older than what is in the database. */
export const live = $state({ stale: false });

/** Signals closer together than this are one reload: staff hear a change to
 *  an open project on two topics, and a burst of moves is many signals. */
const SETTLE_MS = 250;

let client: SupabaseClient | null = null;
let clientFor = '';
const channels = new Map<string, RealtimeChannel>();
const holds = new Set<symbol>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Keeps reloads back until the returned function is called. Call it exactly
 *  once; an `$effect` that returns it does. */
export function hold(): () => void {
  const h = Symbol('hold');
  holds.add(h);
  return () => {
    holds.delete(h);
    if (holds.size === 0 && live.stale) refresh();
  };
}

/** Reloads now, holds or not: for "show me their version" after a page has
 *  decided its own edits can go. */
export function refresh(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  live.stale = false;
  invalidateAll().catch((e: unknown) => report('live', `reloading after a change failed: ${String(e)}`));
}

/** Treats the page as out of date, as if the database had said so: it
 *  reloads shortly, or when the last hold is released. For a page that
 *  knows its own screen may be wrong (a refused save). */
export function changed(): void {
  heard();
}

function heard(): void {
  if (holds.size > 0) {
    live.stale = true;
    return;
  }
  if (timer !== null) clearTimeout(timer);
  // A hold taken while this waits (a drag begun just after the news) wins:
  // the reload waits for it too.
  timer = setTimeout(() => {
    timer = null;
    if (holds.size > 0) live.stale = true;
    else refresh();
  }, SETTLE_MS);
}

let settling: Promise<void> = Promise.resolve();

/** Listens to exactly `topics`, joining new ones and leaving the rest.
 *  `null` (signed out) leaves them all. Safe to call on every navigation:
 *  calls are applied one after another, in order. */
export function listen(config: { url: string; key: string; topics: readonly string[] } | null): Promise<void> {
  settling = settling
    .then(() => apply(config))
    .catch((e: unknown) => {
      report('live', `could not start listening: ${String(e)}`);
    });
  return settling;
}

// `leave` deletes from `channels` while the loops below iterate it, which a
// Map allows: entries already visited stay visited, removed ones are skipped.
async function apply(config: { url: string; key: string; topics: readonly string[] } | null): Promise<void> {
  if (config === null) {
    for (const topic of channels.keys()) await leave(topic);
    return;
  }
  if (client === null || clientFor !== `${config.url} ${config.key}`) {
    for (const topic of channels.keys()) await leave(topic);
    client = createBrowserClient(config.url, config.key);
    clientFor = `${config.url} ${config.key}`;
  }
  // Private channels are joined with the session's token; without it the
  // join is refused, and says so below.
  await client.realtime.setAuth();
  const wanted = new Set(config.topics);
  for (const topic of channels.keys()) if (!wanted.has(topic)) await leave(topic);
  for (const topic of wanted) if (!channels.has(topic)) join(client, topic);
}

function join(supabase: SupabaseClient, topic: string): void {
  let joinedBefore = false;
  const channel = supabase
    .channel(topic, { config: { private: true } })
    .on('broadcast', { event: 'changed' }, heard)
    .subscribe((status, err) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        // Back after a dropped connection: whatever was said meanwhile was
        // not heard, so assume something was.
        if (joinedBefore) heard();
        joinedBefore = true;
      } else if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR || status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT) {
        // supabase-js keeps retrying; this says why the page is not live
        // meanwhile. CLOSED is only ever us leaving.
        report('live', `could not listen to ${topic}: ${err?.message ?? status}`);
      }
    });
  channels.set(topic, channel);
}

async function leave(topic: string): Promise<void> {
  const channel = channels.get(topic);
  channels.delete(topic);
  if (channel !== undefined && client !== null) await client.removeChannel(channel);
}
