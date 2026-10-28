<!--
  A popover anchored to the control that opens it: a native `popover`
  (`auto`, so a click outside or Escape closes it, and opening another
  closes this one), drawn in the top layer and placed by anchor.ts, inside
  the viewport, or as a bottom sheet on a phone-width window (app.css,
  `.yk-popover`). The Build settings, the ⋯ menu and the status bar's
  menus are made of it.

  Its toggle is a button with `popovertarget` set to this popover's `id`,
  so the browser opens and closes it, and Escape gives the toggle its focus
  back. `show(anchor)` opens it from somewhere else (the ⋯ menu's "Build
  settings…" when the Build chip is folded away), anchored to `anchor`.

  When it opens, focus moves to its first control; it closes when focus
  leaves it for something outside, as well as on a click outside.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { placePopover } from '../anchor';

	let {
		id,
		label,
		role = 'group',
		anchor,
		class: className = '',
		children,
		ontoggle,
	}: {
		/** The element id, which the toggle's `popovertarget` names. */
		id: string;
		/** The accessible name: what the popover holds ("Build settings"). */
		label: string;
		/** `group` for a panel of settings (not a dialog: nothing blocks the page), `menu` for a menu of actions. */
		role?: 'group' | 'menu';
		/** The element to place it next to when the toggle opens it; the toggle by default. */
		anchor?: () => HTMLElement | null;
		class?: string;
		children: Snippet;
		/** Told when it opens (true) and closes (false). */
		ontoggle?: (open: boolean) => void;
	} = $props();

	let element: HTMLElement;
	/** The anchor of this opening: the toggle's, or the one `show` was given. */
	let current: HTMLElement | null = null;
	let shownFrom: HTMLElement | null = null;

	/** The toggle that names this popover and is shown, if any. */
	const toggle = (): HTMLElement | null => {
		for (const b of document.querySelectorAll<HTMLElement>(`[popovertarget="${CSS.escape(id)}"]`)) if (b.offsetParent !== null) return b;
		return null;
	};

	/** Opens it next to `from` (a shown element), as if `from` had opened it. */
	export function show(from: HTMLElement): void {
		shownFrom = from;
		if (!element.matches(':popover-open')) element.showPopover();
		else place();
	}

	/** Closes it, if open. */
	export function hide(): void {
		if (element.matches(':popover-open')) element.hidePopover();
	}

	const place = () => {
		current = shownFrom ?? anchor?.() ?? toggle();
		if (current) placePopover(element, current);
	};

	/** The first control a keyboard user lands on: a menu's first item, a panel's first field. */
	const first = (): HTMLElement | null => {
		const selector = role === 'menu' ? '[role^="menuitem"]' : 'input, select, button, textarea, [tabindex="0"]';
		for (const el of element.querySelectorAll<HTMLElement>(selector)) if (el.offsetParent !== null && !(el as HTMLButtonElement).disabled) return el;
		return null;
	};

	function toggled(e: ToggleEvent) {
		if (e.newState === 'open') {
			place();
			addEventListener('resize', place);
			first()?.focus();
			ontoggle?.(true);
		} else {
			removeEventListener('resize', place);
			shownFrom = null;
			ontoggle?.(false);
		}
	}

	function keydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			// The browser closes it; focus goes back where the person was.
			e.preventDefault();
			hide();
			current?.focus();
			return;
		}
		if (role !== 'menu' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
		const items = [...element.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter((el) => el.offsetParent !== null && !(el as HTMLButtonElement).disabled);
		if (!items.length) return;
		e.preventDefault();
		const at = items.indexOf(document.activeElement as HTMLElement);
		const index = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
		items[index]?.focus();
	}

	function focusout(e: FocusEvent) {
		const to = e.relatedTarget;
		// Focus left for another control: close. (Null is a click on nothing focusable, which light dismiss handles.)
		if (to instanceof Node && !element.contains(to) && to !== current) hide();
	}
</script>

<div bind:this={element} {id} popover="auto" class="yk-popover {className}" {role} aria-label={label} ontoggle={toggled} onkeydown={keydown} onfocusout={focusout}>
	{@render children()}
</div>
