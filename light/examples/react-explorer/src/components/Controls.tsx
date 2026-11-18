/**
 * The widgets' small controls: a segmented picker, a button that says why
 * it is disabled, a run's status line.
 */
import type { Availability } from '@yukibana/core';
import type { RunState } from '@yukibana/runtime';
import { useId, type ReactNode } from 'react';
import { statusOf } from '../yukibana/useRun.ts';

/** One choice of a {@link Segmented}. */
export interface Choice<V extends string> {
	/** Its value. */
	readonly value: V;
	/** What it shows. */
	readonly label: string;
	/** Its tooltip. */
	readonly title?: string;
	/** Why it cannot be chosen, when it cannot. */
	readonly disabled?: string;
}

/** A row of mutually exclusive choices, as radio buttons, `value` the chosen one. */
export function Segmented<V extends string>({ label, choices, value, onChange, name }: { readonly label: string; readonly choices: readonly Choice<V>[]; readonly value: V; readonly onChange: (value: V) => void; readonly name?: string }): ReactNode {
	const id = useId();
	return (
		<fieldset className="segmented">
			<legend>{label}</legend>
			{choices.map((choice) => (
				<label key={choice.value} title={choice.disabled ?? choice.title} className={choice.value === value ? 'on' : undefined} data-disabled={choice.disabled === undefined ? undefined : true}>
					<input type="radio" name={name ?? id} value={choice.value} checked={choice.value === value} disabled={choice.disabled !== undefined} onChange={() => onChange(choice.value)} />
					{choice.label}
				</label>
			))}
		</fieldset>
	);
}

/** A button enabled exactly when `availability` says, with its reason as the tooltip when it is not. */
export function ActionButton({ availability, onClick, children, kind = 'primary', title, busy = false, name }: { readonly availability: Availability; readonly onClick: () => void; readonly children: ReactNode; readonly kind?: 'primary' | 'quiet'; readonly title?: string; readonly busy?: boolean; readonly name?: string }): ReactNode {
	const disabled = availability.kind === 'unavailable' || busy;
	return (
		<button type="button" className={`button ${kind}`} disabled={disabled} title={availability.kind === 'unavailable' ? availability.reason : title} onClick={onClick} data-action={name}>
			{children}
		</button>
	);
}

/** The run's status, coloured by how it is going or how it ended. */
export function RunStatus({ state }: { readonly state: RunState | null }): ReactNode {
	const tone = state === null ? 'idle' : state.kind === 'ended' ? (state.code === 0 ? 'ok' : 'bad') : state.kind === 'failed' || state.kind === 'unavailable' ? 'bad' : state.kind === 'stopped' ? 'idle' : 'busy';
	return (
		<span className={`status ${tone}`} role="status" data-state={state?.kind ?? 'idle'}>
			{statusOf(state)}
		</span>
	);
}
