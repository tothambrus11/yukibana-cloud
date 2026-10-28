<!--
  The C and C++ sanitizers (cpp-sanitizers.ts): AddressSanitizer and
  UndefinedBehaviorSanitizer, each a checkbox that rewrites the -fsanitize=
  line of compile_flags.txt, with what it finds. A row of the Build
  settings popover (BuildSettings.svelte); it used to be a top-bar button
  with a popover of its own, which was cut off at the window's edge.
-->
<script lang="ts">
	import { SANITIZERS, type SanitizerId } from '../cpp-sanitizers';
	import type { Workspace } from '../workspace.svelte';

	let { workspace }: { workspace: Workspace } = $props();

	const choice = $derived(workspace.sanitizers ?? { address: false, undefined: false });
	const toggle = (id: SanitizerId, on: boolean) => workspace.chooseSanitizers({ ...choice, [id]: on });
</script>

<div class="sanitizers">
	{#each SANITIZERS as s (s.id)}
		<label>
			<input type="checkbox" checked={choice[s.id]} onchange={(e) => toggle(s.id, e.currentTarget.checked)} />
			<span>{s.label} <code>-fsanitize={s.id}</code><small>{s.finds}</small></span>
		</label>
	{/each}
	<p>Reports go to the terminal with the file and line. The program runs slower, and its first Run downloads the sanitizer's runtime.</p>
</div>

<style>
	.sanitizers {
		display: grid;
		gap: 0.6rem;
	}
	label {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		cursor: pointer;
	}
	input {
		flex: none;
		margin-top: 0.2rem;
	}
	code {
		color: var(--gray-3);
		font-size: 0.75rem;
		white-space: nowrap;
	}
	small,
	p {
		display: block;
		margin: 0;
		color: var(--gray-3);
		font-size: 0.75rem;
		line-height: 1.35;
	}
</style>
