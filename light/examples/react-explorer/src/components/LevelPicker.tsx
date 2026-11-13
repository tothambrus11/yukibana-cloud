/**
 * An optimisation level picker over a language's level property: what it
 * writes is what the runner, the explorer and a download would all read.
 */
import type { ReactNode } from 'react';
import type { LevelSetting } from '../article/settings.ts';
import type { MemoryProject } from '../yukibana/project.ts';
import { useProperty } from '../yukibana/useProperty.ts';
import { Segmented } from './Controls.tsx';

/** The levels of `setting` as radio buttons, the project's level checked; choosing one writes it into `project`. */
export function LevelPicker({ project, setting, name }: { readonly project: MemoryProject; readonly setting: LevelSetting; readonly name?: string }): ReactNode {
	const level = useProperty(project, setting.property);
	const choices = setting.levels.map((l) => ({ value: l.flag, label: l.flag, title: l.label, ...(l.unavailable === undefined ? {} : { disabled: l.unavailable }) }));
	return <Segmented label="Optimisation" choices={choices} value={level.value} onChange={level.set} {...(name === undefined ? {} : { name })} />;
}
