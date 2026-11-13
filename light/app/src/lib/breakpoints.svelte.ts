/**
 * The project's breakpoints, and how the editors show them: the part of
 * the debugger that is there before Debug is first clicked. The session
 * itself (debug.svelte.ts: the DAP client, its worker, the Debug panel's
 * state) loads on that click; until then a click in an editor's margin
 * sets a breakpoint here, and the session sends what is here once it has
 * one to send it to.
 */

/**
 * What the breakpoints and the editors need of a debugging session
 * (debug.svelte.ts, `Debugger`).
 */
export interface BreakpointSession {
	/** Returns the 1-based line the program is stopped at in `path` (the selected frame's), or null when it is not stopped there. */
	stoppedLine(path: string): number | null;
	/** The index of the selected frame in the call stack: 0 is the innermost, where the program stopped. */
	readonly selected: number;
	/** Called after the breakpoints of `path` changed, so that a running session sends them. */
	changed(path: string): void;
}

export class Breakpoints {
	/**
	 * The breakpoints, by project path: 1-based lines, ascending, no line
	 * twice. Kept from one session to the next.
	 */
	lines = $state<Record<string, number[]>>({});
	/**
	 * The debugging session the editors show the stopped line of: null until
	 * Debug is first clicked, then the one `Debugger` there is, which sets
	 * itself here.
	 */
	session = $state.raw<BreakpointSession | null>(null);

	/** Turns the breakpoint at `line` of `path` on or off, and tells the session. */
	toggle(path: string, line: number): void {
		const lines = this.lines[path] ?? [];
		const next = lines.includes(line) ? lines.filter((l) => l !== line) : [...lines, line].sort((a, b) => a - b);
		this.lines = { ...this.lines, [path]: next };
		this.session?.changed(path);
	}

	/** The breakpoints of a file that was renamed or deleted (`to` null) follow it. */
	move(from: string, to: string | null): void {
		if (!(from in this.lines)) return;
		const { [from]: lines, ...rest } = this.lines;
		this.lines = to && lines ? { ...rest, [to]: lines } : rest;
	}
}

/** What `decorate` needs of Monaco: passed in, so this module loads without it (the Node-run tests). */
interface MonacoLike {
	editor: { MouseTargetType: { GUTTER_GLYPH_MARGIN: number; GUTTER_LINE_NUMBERS: number } };
	Range: new (a: number, b: number, c: number, d: number) => unknown;
}

/**
 * Shows `breakpoints` of the file `path` in `editor`'s glyph margin, and
 * the line the program is stopped at once there is a session, and makes a
 * click in the margin turn a breakpoint on or off. Kept in step with the
 * breakpoints and the session until the returned function is called.
 */
export function decorate(
	editor: import('monaco-editor').editor.IStandaloneCodeEditor,
	path: string,
	breakpoints: Breakpoints,
	monaco: MonacoLike,
): () => void {
	const decorations = editor.createDecorationsCollection();
	const mouse = editor.onMouseDown((e) => {
		const type = e.target.type;
		if (type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
		const line = e.target.position?.lineNumber;
		if (line) breakpoints.toggle(path, line);
	});
	const stop = $effect.root(() => {
		$effect(() => {
			const lines = breakpoints.lines[path] ?? [];
			const session = breakpoints.session;
			const stopped = session?.stoppedLine(path) ?? null;
			const top = (session?.selected ?? 0) === 0;
			const onBreakpoint = stopped !== null && lines.includes(stopped);
			const range = (line: number) => new monaco.Range(line, 1, line, 1) as import('monaco-editor').IRange;
			decorations.set([
				// The stopped line's one decoration draws its breakpoint too (app.css says why).
				...lines
					.filter((line) => line !== stopped)
					.map((line) => ({
						range: range(line),
						options: { glyphMarginClassName: 'debug-breakpoint', glyphMarginHoverMessage: { value: 'Breakpoint (click to remove)' }, stickiness: 1 },
					})),
				...(stopped !== null
					? [
							{
								range: range(stopped),
								options: {
									isWholeLine: true,
									className: top ? 'debug-stopped-line' : 'debug-frame-line',
									glyphMarginClassName: `${top ? 'debug-stopped' : 'debug-frame'}${onBreakpoint ? ' debug-on-breakpoint' : ''}`,
									...(onBreakpoint ? { glyphMarginHoverMessage: { value: 'Breakpoint (click to remove)' } } : {}),
									stickiness: 1,
								},
							},
						]
					: []),
			]);
			if (stopped !== null) editor.revealLineInCenterIfOutsideViewport(stopped);
		});
	});
	return () => {
		stop();
		mouse.dispose();
		decorations.clear();
	};
}
