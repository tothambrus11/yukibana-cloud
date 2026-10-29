<!--
  How Run runs a C++ program built for a Linux target (cpp-targets.ts,
  RunOptions): in Linux under QEMU's system emulation (the default) or with
  QEMU's user mode, on how many CPUs, and whether its system calls are
  traced. A row of the Build settings popover (BuildSettings.svelte),
  loaded the first time a project is on a Linux target; the choice is saved
  with the project.
-->
<script lang="ts">
	import type { Workspace } from '../workspace.svelte';
	import Select, { type SelectOption } from './Select.svelte';

	const CPUS: readonly SelectOption[] = ['1', '2', '4'].map((n) => ({ value: n, label: n }));

	let { workspace }: { workspace: Workspace } = $props();

	const options = $derived(workspace.runOptions);
</script>

<div class="run-options">
	<fieldset>
		<legend>Emulation</legend>
		<label>
			<input type="radio" name="emulation" value="system" checked={options.emulation === 'system'} onchange={() => workspace.setRunOptions({ emulation: 'system' })} />
			<span>System: Linux in QEMU<small>The real Linux kernel: signals, threads on several CPUs, /proc.</small></span>
		</label>
		<label>
			<input type="radio" name="emulation" value="user" checked={options.emulation === 'user'} onchange={() => workspace.setRunOptions({ emulation: 'user' })} />
			<span>User mode (experimental)<small>QEMU translates system calls itself: smaller and starts sooner, but no kernel underneath: one CPU, no fork, and a null dereference reads 0 instead of crashing.</small></span>
		</label>
	</fieldset>
	<div class="row cpus" title={options.emulation === 'user' ? 'User mode emulates one CPU' : 'The guest’s CPUs'}>
		<span>CPUs<small>{options.emulation === 'user' ? 'User mode emulates one CPU.' : 'The guest’s CPUs, for threads.'}</small></span>
		<Select label="CPUs" value={String(options.cpus)} options={CPUS} disabled={options.emulation === 'user'} onchange={(v) => workspace.setRunOptions({ cpus: Number(v) as 1 | 2 | 4 })} />
	</div>
	<label class="row">
		<span>strace<small>Show the program's system calls in the terminal, dimmed.</small></span>
		<input type="checkbox" checked={options.strace} onchange={(e) => workspace.setRunOptions({ strace: e.currentTarget.checked })} />
	</label>
</div>

<style>
	.run-options {
		display: grid;
		gap: 0.7rem;
	}
	fieldset {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend {
		margin-bottom: 0.4rem;
		color: var(--white);
		font-weight: 600;
	}
	fieldset label {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		cursor: pointer;
	}
	fieldset input {
		flex: none;
		margin-top: 0.2rem;
	}
	small {
		display: block;
		color: var(--gray-3);
		font-size: 0.75rem;
		line-height: 1.35;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		color: var(--white);
	}
</style>
