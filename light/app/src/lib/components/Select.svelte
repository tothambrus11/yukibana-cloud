<!--
  A drop-down list to choose one value from, in place of a native `select`:
  a button that says what is chosen and opens a list of the choices, with a
  search field above them when there are enough to need one.

  The list is a native `popover` (`auto`), placed by anchor.ts like the
  app's other popovers: below the button, inside the viewport, at least as
  wide as the button, and on a phone-width window a bottom sheet with the
  control's name above it (app.css, `.yk-popover`). Inside another popover
  (the Build settings) it is that popover's child in the DOM, so opening it
  keeps its parent open, and Escape closes the list alone.

  A native select looked different in every browser, showed its options in
  the system's font and colours, could not be searched, and on a desktop
  drew its list wherever the platform chose, past the edge of a narrow
  window. Typing still works as it does there: with the list open, letters
  go to the search field, or, in a short list without one, jump to the
  first choice that starts with them.

  Keyboard: Enter, Space, ArrowDown or ArrowUp on the button opens the list
  on the chosen value; ArrowUp/ArrowDown, Home/End and PageUp/PageDown move;
  Enter chooses; Escape or Tab closes without choosing.
-->
<script lang="ts" module>
	import type { Searchable } from '../select-search';

	/** One choice of a Select; the search (select-search.ts) reads its label, detail, keywords and value. */
	export interface SelectOption extends Searchable {
		/** What `onchange` receives; unique within the list. */
		value: string;
		/** What the list and the button show. */
		label: string;
		/** Shown but not choosable: a hand-written value the list does not offer, a level not available yet. */
		disabled?: boolean;
		/** The option's tooltip: why it is disabled, what it does. */
		title?: string;
	}

	/** A list longer than this gets a search field; a shorter one is read at a glance. */
	export const SEARCH_FROM = 6;

	let nextId = 0;
</script>

<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { placePopover, sheetMode } from '../anchor';
	import { marked, search as find } from '../select-search';

	let {
		label,
		value,
		options,
		onchange,
		disabled = false,
		searchable = options.length > SEARCH_FROM,
		placeholder = 'Choose…',
		class: className = '',
		title,
		button,
	}: {
		/** The control's accessible name, and the heading of the list when it is a bottom sheet. */
		label: string;
		/** The chosen value; one no option has shows `placeholder`. */
		value: string;
		options: readonly SelectOption[];
		/** Told the value chosen, only when it differs from `value`. The caller decides what `value` becomes. */
		onchange: (value: string) => void;
		disabled?: boolean;
		/** Whether the list has a search field: by default when it has more than SEARCH_FROM options. */
		searchable?: boolean;
		/** What the button says when `value` is no option's. */
		placeholder?: string;
		/** Classes for the button (the bar's language picker draws its own). */
		class?: string;
		/** The button's tooltip; the chosen option's label by default. */
		title?: string;
		/** What the button shows in place of the chosen option's label (the language picker's full and short names). */
		button?: Snippet<[SelectOption | undefined]>;
	} = $props();

	const id = `yk-select-${++nextId}`;
	let trigger: HTMLButtonElement;
	let list: HTMLElement;
	let search = $state<HTMLInputElement>();
	let listbox = $state<HTMLElement>();
	let open = $state(false);
	/** Whether this opening is a bottom sheet (a phone-width window), which names the control above the list. */
	let sheet = $state(false);
	let query = $state('');
	/** The option the keyboard is on, by value: null when none is (a search that matches nothing). */
	let active = $state<string | null>(null);

	const chosen = $derived(options.find((o) => o.value === value));
	const shown = $derived(find(options, query));
	const choosable = $derived(shown.filter((o) => !o.disabled));

	const optionId = (v: string) => `${id}-${options.findIndex((o) => o.value === v)}`;

	const place = () => {
		// At least as wide as the button, so a short list does not hang off a long label.
		list.style.setProperty('--select-min-width', `${Math.round(trigger.getBoundingClientRect().width)}px`);
		placePopover(list, trigger);
	};

	function show(): void {
		if (disabled || open) return;
		query = '';
		sheet = sheetMode();
		active = chosen && !chosen.disabled ? chosen.value : (choosable[0]?.value ?? null);
		list.showPopover();
	}

	function hide(refocus: boolean): void {
		if (list.matches(':popover-open')) list.hidePopover();
		if (refocus) trigger.focus();
	}

	function choose(option: SelectOption): void {
		if (option.disabled) return;
		hide(true);
		if (option.value !== value) onchange(option.value);
	}

	async function toggled(e: ToggleEvent): Promise<void> {
		open = e.newState === 'open';
		if (!open) {
			removeEventListener('resize', place);
			return;
		}
		place();
		addEventListener('resize', place);
		await tick();
		// A phone's keyboard would cover the list it opened for: there, the search field waits to be tapped.
		if (search && !matchMedia('(pointer: coarse)').matches) search.focus();
		else listbox?.focus();
		reveal();
	}

	/** Scrolls the active option into the list's view. */
	function reveal(): void {
		if (active === null) return;
		document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
	}

	function move(by: number): void {
		const items = choosable;
		if (!items.length) return;
		const at = items.findIndex((o) => o.value === active);
		// From none, down starts at the first and up at the last.
		const from = at >= 0 ? at : by > 0 ? -1 : items.length;
		active = items[Math.max(0, Math.min(items.length - 1, from + by))]?.value ?? null;
		void tick().then(reveal);
	}

	/** Where PageUp and PageDown go: as many options as the list shows at once. */
	const page = () => Math.max(1, Math.floor((listbox?.clientHeight ?? 0) / 36));

	function triggerKey(e: KeyboardEvent): void {
		if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
			e.preventDefault();
			show();
		}
	}

	/** The type-ahead of a list without a search field: letters typed within a second jump to the option that starts with them. */
	let typed = '';
	let typedAt = 0;

	function listKey(e: KeyboardEvent): void {
		switch (e.key) {
			case 'Escape':
				// This list only: a Build settings popover around it stays open.
				e.preventDefault();
				e.stopPropagation();
				hide(true);
				return;
			case 'Tab':
				hide(false);
				return;
			case 'ArrowDown':
				e.preventDefault();
				move(1);
				return;
			case 'ArrowUp':
				e.preventDefault();
				move(-1);
				return;
			case 'PageDown':
				e.preventDefault();
				move(page());
				return;
			case 'PageUp':
				e.preventDefault();
				move(-page());
				return;
			case 'Home':
			case 'End':
				// In the search field they move its caret.
				if (e.target === search) return;
				e.preventDefault();
				active = (e.key === 'Home' ? choosable[0] : choosable.at(-1))?.value ?? null;
				void tick().then(reveal);
				return;
			case 'Enter': {
				e.preventDefault();
				const option = choosable.find((o) => o.value === active);
				if (option) choose(option);
				return;
			}
		}
		if (e.target !== search && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
			const now = performance.now();
			typed = (now - typedAt < 1000 ? typed : '') + e.key.toLowerCase();
			typedAt = now;
			const found = choosable.find((o) => o.label.toLowerCase().startsWith(typed));
			if (found) {
				active = found.value;
				void tick().then(reveal);
			}
		}
	}

	function searched(): void {
		// The best match is the first that is choosable, so Enter chooses it.
		if (!choosable.some((o) => o.value === active)) active = choosable[0]?.value ?? null;
		void tick().then(reveal);
	}
</script>

<button
	bind:this={trigger}
	type="button"
	class="yk-select-button {className}"
	{disabled}
	aria-haspopup="listbox"
	aria-expanded={open}
	aria-controls="{id}-list"
	aria-label="{label}: {chosen?.label ?? placeholder}"
	title={title ?? chosen?.title ?? chosen?.label ?? placeholder}
	data-value={value}
	onclick={() => (open ? hide(true) : show())}
	onkeydown={triggerKey}
>
	{#if button}
		{@render button(chosen)}
	{:else}
		<span class="truncate">{chosen?.label ?? placeholder}</span>
		{#if chosen?.detail}<span class="detail">{chosen.detail}</span>{/if}
	{/if}
	<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
</button>

<div bind:this={list} id="{id}-popover" popover="auto" role="presentation" class="yk-popover yk-select-list" ontoggle={toggled} onkeydown={listKey}>
	{#if sheet}
		<div class="sheet-title">{label}</div>
	{/if}
	{#if searchable}
		<div class="search">
			<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4l3.6 3.6" /></svg>
			<input
				bind:this={search}
				bind:value={query}
				oninput={searched}
				type="search"
				role="combobox"
				aria-label="Search {label}"
				aria-expanded="true"
				aria-controls="{id}-list"
				aria-autocomplete="list"
				aria-activedescendant={active === null ? undefined : optionId(active)}
				placeholder="Search"
				autocomplete="off"
				spellcheck="false"
			/>
		</div>
	{/if}
	<!-- Focus stays in the search field (or on the list itself); the options are pointed at, not focused, so a click never moves it. -->
	<div
		bind:this={listbox}
		id="{id}-list"
		class="options"
		role="listbox"
		tabindex="-1"
		aria-label={label}
		aria-activedescendant={!searchable && active !== null ? optionId(active) : undefined}
	>
		{#each shown as o (o.value)}
			{@const [before, match, after] = marked(o.label, query)}
			<div
				id={optionId(o.value)}
				class="option"
				class:active={o.value === active}
				role="option"
				tabindex="-1"
				aria-selected={o.value === value}
				aria-disabled={o.disabled || undefined}
				title={o.title}
				data-value={o.value}
				onpointerdown={(e) => e.preventDefault()}
				onpointermove={() => {
					if (!o.disabled) active = o.value;
				}}
				onclick={() => choose(o)}
				onkeydown={() => {}}
			>
				<svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
				<span class="label">{before}{#if match}<mark>{match}</mark>{/if}{after}</span>
				{#if o.detail}<span class="detail">{o.detail}</span>{/if}
			</div>
		{:else}
			<div class="none">Nothing matches “{query.trim()}”.</div>
		{/each}
	</div>
</div>

<style>
	.yk-select-button {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		justify-self: start;
		min-width: 0;
		max-width: 100%;
		min-height: 2rem;
		padding: 0 0.55rem 0 0.65rem;
		border: 1px solid var(--control-border);
		border-radius: 0.35rem;
		background: var(--gray-7);
		color: var(--white);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.yk-select-button:hover:not(:disabled),
	.yk-select-button[aria-expanded='true'] {
		border-color: var(--gray-3);
	}
	.yk-select-button:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}
	.yk-select-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	/* A finger's height on a touch screen, as the bar's buttons have (app.css). */
	@media (pointer: coarse) {
		.yk-select-button {
			min-height: 2.75rem;
		}
	}
	.chevron {
		flex: none;
		width: 0.8rem;
		height: 0.8rem;
		margin-left: auto;
		fill: none;
		stroke: var(--gray-2);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: transform 0.15s;
	}
	[aria-expanded='true'] > .chevron {
		transform: rotate(180deg);
	}
	.detail {
		flex: none;
		color: var(--gray-3);
		font-size: 0.75rem;
	}

	/* The list: a .yk-popover (app.css) with a search field that stays put above options that scroll. */
	:global(.yk-select-list) {
		display: none;
		flex-direction: column;
		width: max-content;
		min-width: var(--select-min-width, 10rem);
		max-width: min(24rem, calc(100vw - 1rem));
		max-height: min(24rem, calc(var(--app-height, 100dvh) - 1rem)) !important;
		overflow: hidden !important;
		padding: 0.3rem !important;
	}
	:global(.yk-select-list:popover-open) {
		display: flex;
	}
	.sheet-title {
		padding: 0.5rem 0.6rem 0.6rem;
		color: var(--gray-2);
		font-weight: 600;
	}
	.search {
		position: relative;
		flex: none;
		margin-bottom: 0.3rem;
	}
	.search svg {
		position: absolute;
		top: 50%;
		left: 0.55rem;
		width: 0.85rem;
		height: 0.85rem;
		transform: translateY(-50%);
		fill: none;
		stroke: var(--gray-3);
		stroke-width: 1.6;
		stroke-linecap: round;
		pointer-events: none;
	}
	.search input {
		box-sizing: border-box;
		width: 100%;
		min-height: 2rem;
		padding: 0 0.6rem 0 1.85rem;
		border: 1px solid var(--gray-5);
		border-radius: 0.3rem;
		background: var(--gray-7);
		color: var(--white);
		font: inherit;
	}
	.search input:focus {
		border-color: var(--accent);
		outline: none;
	}
	.options {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		outline: none;
	}
	.option {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 2rem;
		padding: 0.25rem 0.6rem 0.25rem 0.4rem;
		border-radius: 0.3rem;
		color: var(--white);
		line-height: 1.3;
		cursor: pointer;
		user-select: none;
	}
	.option.active {
		background: var(--gray-5);
	}
	.options:focus-visible .option.active,
	.search:focus-within + .options .option.active {
		outline: 1px solid var(--accent);
		outline-offset: -1px;
	}
	.option[aria-disabled='true'] {
		color: var(--gray-3);
		cursor: default;
	}
	.label {
		flex: 1 1 auto;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	mark {
		background: none;
		color: var(--accent-high);
		font-weight: 600;
	}
	.tick {
		flex: none;
		width: 0.85rem;
		height: 0.85rem;
		fill: none;
		stroke: var(--accent-high);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
		visibility: hidden;
	}
	[aria-selected='true'] > .tick {
		visibility: visible;
	}
	.option .detail {
		margin-left: 0.75rem;
	}
	.none {
		padding: 0.5rem 0.6rem;
		color: var(--gray-3);
	}
	@media (pointer: coarse) {
		.option,
		.search input {
			min-height: 2.75rem;
		}
	}
	/* A phone: a bottom sheet the width of the screen (app.css), up to most of its height. */
	@media (width < 40em) {
		:global(.yk-select-list) {
			width: 100% !important;
			max-width: 100% !important;
			max-height: min(32rem, calc(var(--app-height, 100dvh) * 0.75)) !important;
		}
		/* A sheet over a sheet (a list from Build settings): the page behind it dims, so which one is in front is plain. */
		:global(.yk-select-list::backdrop) {
			background: rgb(0 0 0 / 0.35);
		}
	}
</style>
