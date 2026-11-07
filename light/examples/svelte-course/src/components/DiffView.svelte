<!--
@component
The model solution as a diff of the student's file: what would go (−) and
come (+), with two lines of context around each change (diff.ts). Shows
"identical" when there is nothing to change.
-->
<script lang="ts">
	import { countsOf, diffLines, hunksOf } from '../lib/diff.ts';

	interface Props {
		/** The student's text. */
		before: string;
		/** The solution. */
		after: string;
		/** The file's name, for the header. */
		file: string;
	}

	let { before, after, file }: Props = $props();

	const lines = $derived(diffLines(before, after));
	const hunks = $derived(hunksOf(lines, 2));
	const counts = $derived(countsOf(lines));
</script>

<figure class="diff">
	<figcaption>
		<span class="file">{file}</span>
		<span class="counts"><span class="del">−{counts.removed}</span> <span class="add">+{counts.added}</span></span>
	</figcaption>
	{#if hunks.length === 0}
		<p class="identical">Your file is the solution, line for line.</p>
	{:else}
		<div class="body">
			{#each hunks as hunk, at (at)}
				{#if at > 0}<div class="gap" aria-hidden="true">⋯</div>{/if}
				{#each hunk.lines as line, index (index)}
					<div class="line {line.kind}">
						<span class="num">{line.before ?? ''}</span><span class="num">{line.after ?? ''}</span><span class="sign">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span><code>{line.text}</code>
					</div>
				{/each}
			{/each}
		</div>
	{/if}
</figure>

<style>
	.diff {
		margin: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--code-bg);
	}
	figcaption {
		display: flex;
		justify-content: space-between;
		padding: 6px 12px;
		font: 12.5px var(--mono);
		color: var(--muted);
		border-bottom: 1px solid var(--line);
		background: var(--panel);
	}
	.del {
		color: var(--fail-ink);
	}
	.add {
		color: var(--pass-ink);
	}
	.body {
		overflow-x: auto;
		padding: 6px 0;
		font: 13px/1.6 var(--mono);
	}
	.line {
		display: grid;
		grid-template-columns: 3ch 3ch 2ch max-content;
		gap: 0 8px;
		padding: 0 12px;
	}
	.num {
		text-align: right;
		color: var(--faint);
		user-select: none;
	}
	.sign {
		user-select: none;
	}
	.removed {
		background: var(--fail-soft);
		color: var(--fail-ink);
	}
	.added {
		background: var(--pass-soft);
		color: var(--pass-ink);
	}
	code {
		font: inherit;
		white-space: pre;
	}
	.gap {
		padding: 2px 12px;
		color: var(--faint);
	}
	.identical {
		margin: 0;
		padding: 12px;
		color: var(--pass-ink);
	}
</style>
