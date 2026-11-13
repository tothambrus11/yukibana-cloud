<!--
@component
An exercise's checks as the latest Check left them: each a row with its
outcome (pending, passed, failed, skipped) and, for a failure, the
framework's first words on why. Rows carry `data-outcome` and
`data-check` (the test's id), which the end-to-end test reads.
-->
<script lang="ts">
	import type { CheckItem } from '../lib/report.ts';

	interface Props {
		/** The checks, in the exercise's order (report.ts `checklistOf`). */
		items: readonly CheckItem[];
	}

	let { items }: Props = $props();

	/** The mark and the screen reader's word for an outcome. */
	const MARKS: Readonly<Record<CheckItem['outcome'], { mark: string; word: string }>> = {
		pending: { mark: '○', word: 'not run' },
		passed: { mark: '✓', word: 'passed' },
		failed: { mark: '✕', word: 'failed' },
		skipped: { mark: '–', word: 'skipped' },
		todo: { mark: '–', word: 'to do' },
	};
</script>

<ul class="checklist">
	{#each items as item (item.id)}
		<li data-outcome={item.outcome} data-check={item.id}>
			<span class="mark" aria-hidden="true">{MARKS[item.outcome].mark}</span>
			<span class="label">{item.label}<span class="sr">: {MARKS[item.outcome].word}</span></span>
			{#if item.message !== null}<pre class="why">{item.message}</pre>{/if}
		</li>
	{/each}
</ul>

<style>
	.checklist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	li {
		display: grid;
		grid-template-columns: 22px 1fr;
		align-items: baseline;
		gap: 0 8px;
		padding: 6px 10px;
		border-radius: 8px;
		transition: background-color 160ms ease;
	}
	.mark {
		display: inline-grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		font-size: 12px;
		font-weight: 700;
		color: var(--muted);
		border: 1.5px solid var(--line-strong);
		transform: translateY(3px);
	}
	[data-outcome='passed'] .mark {
		color: var(--on-pass);
		background: var(--pass);
		border-color: var(--pass);
	}
	[data-outcome='failed'] {
		background: var(--fail-soft);
	}
	[data-outcome='failed'] .mark {
		color: var(--on-fail);
		background: var(--fail);
		border-color: var(--fail);
	}
	.label {
		font-size: 15px;
	}
	[data-outcome='pending'] .label {
		color: var(--muted);
	}
	.why {
		grid-column: 2;
		margin: 4px 0 0;
		padding: 0;
		font: 12.5px/1.5 var(--mono);
		color: var(--fail-ink);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
