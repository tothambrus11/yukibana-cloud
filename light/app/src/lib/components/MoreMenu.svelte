<!--
  The top bar's ⋯ menu, and what decides which of the bar's controls fold
  into it.

  Each foldable control in the bar carries `data-fold="<rem>"`, and so does
  its twin in this menu, which is hidden until the bar is narrower than
  that many rem; then the bar's copy hides and the menu's shows (app.css,
  "The top bar's folding"). The bar's width is what counts, not the
  window's, so a split screen or a 200% zoom folds the same way. Download,
  Reset and Restart language server are always here.

  Two equivalent sets of rules do it, and exactly one is on. Container
  queries on the header (`.bar-host.cq`), when this browser has them and
  they reach into an open popover in the top layer, which a one-time probe
  checks; otherwise a ResizeObserver writes the tiers the bar is under into
  the header's `data-tier` (`"70 56 44"`). The layout test forces the
  second (tests/e2e-layout.mjs), so both run in CI.
-->
<script lang="ts" module>
	/** The bar's tiers, in rem: below each, the controls with that `data-fold` move into the menu. */
	export const TIERS = [70, 56, 44, 30, 22] as const;

	/** The tiers a bar `widthRem` rem wide is under, as `data-tier` lists them. */
	export function tiersOf(widthRem: number): string {
		return TIERS.filter((t) => widthRem < t).join(' ');
	}

	/**
	 * Whether a container query on `host` reaches an element inside an open
	 * top-layer popover in it: the menu's twins are there. Shows a probe
	 * popover for the length of one call; nothing is painted in between.
	 */
	function queriesReachPopovers(host: HTMLElement): boolean {
		if (typeof CSS === 'undefined' || !CSS.supports('container-type: inline-size')) return false;
		const probe = document.createElement('div');
		probe.setAttribute('popover', 'manual');
		probe.className = 'cq-probe';
		const inner = document.createElement('span');
		probe.append(inner);
		host.append(probe);
		try {
			probe.showPopover();
			return getComputedStyle(inner).getPropertyValue('--cq-probe').trim() === '1';
		} catch {
			return false;
		} finally {
			probe.remove();
		}
	}
</script>

<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import Popover from './Popover.svelte';

	let { children }: { children: Snippet } = $props();

	let button: HTMLButtonElement;
	let popover = $state<Popover>();
	let open = $state(false);

	onMount(() => {
		const host = button.closest<HTMLElement>('.bar-host');
		if (!host) return;
		if (queriesReachPopovers(host)) {
			host.classList.add('cq');
			return;
		}
		const observer = new ResizeObserver(([entry]) => {
			if (!entry) return;
			const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
			const tiers = tiersOf(entry.contentRect.width / rem);
			if (host.dataset['tier'] !== tiers) host.dataset['tier'] = tiers;
		});
		observer.observe(host);
		return () => observer.disconnect();
	});

	/** An action chosen closes the menu; a checkbox item (a view) leaves it open to tick another. */
	function chosen(e: MouseEvent) {
		const item = e.target instanceof Element ? e.target.closest('[role="menuitem"]') : null;
		if (item) popover?.hide();
	}
</script>

<button bind:this={button} class="icon-btn more" popovertarget="more-menu" aria-haspopup="menu" aria-expanded={open} aria-label="More" title="More">
	<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></svg>
</button>
<Popover bind:this={popover} id="more-menu" label="More" role="menu" class="more-menu" ontoggle={(o) => (open = o)}>
	<!-- The items are buttons; this only closes the menu after one is chosen. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="items" onclick={chosen}>
		{@render children()}
	</div>
</Popover>

<style>
	.more svg {
		fill: currentColor;
		stroke: currentColor;
	}
	:global(.more-menu) {
		min-width: 15rem;
	}
	.items {
		display: grid;
	}
</style>
