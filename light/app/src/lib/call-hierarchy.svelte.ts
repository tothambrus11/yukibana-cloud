/**
 * What the Call Hierarchy panel shows: one function's callers or callees
 * as a tree, each level asked of the language server when it is expanded,
 * as VS Code's view does. The rows themselves are plain data
 * (lsp/call-hierarchy.ts); this holds which are expanded and what each
 * expansion answered.
 */
import type * as lsp from 'vscode-languageserver-protocol';
import { rootRow, toRows, type CallDirection, type CallRow } from './lsp/call-hierarchy';

/**
 * Asks the server for one level: the calls on `direction`'s side of `item`.
 * Null when the server did not answer (it failed, which the client has
 * logged, or it stopped).
 */
export type AskCalls = (direction: CallDirection, item: lsp.CallHierarchyItem) => Promise<(lsp.CallHierarchyIncomingCall | lsp.CallHierarchyOutgoingCall)[] | null>;

/** One node of the tree: a row and, once expanded, its children. */
export class CallNode {
	/** Whether the children are shown. */
	expanded = $state(false);
	/**
	 * The children: null until the first expansion has answered, then the
	 * rows (possibly none). Kept when collapsed, so expanding again asks
	 * nothing.
	 */
	children = $state.raw<CallNode[] | null>(null);
	/** True while the server is asked for the children. */
	loading = $state(false);
	/** Why the children could not be had, if they could not. */
	failed = $state<string | null>(null);

	constructor(
		readonly row: CallRow,
		/** The functions above this one, from the root down. */
		readonly ancestors: readonly lsp.CallHierarchyItem[],
		private readonly tree: CallHierarchy,
	) {}

	/** Whether the node can have children: every node but a recursive one. */
	get expandable(): boolean {
		return !this.row.recursive;
	}

	/** Expands or collapses the node; the first expansion asks the server. */
	async toggle(): Promise<void> {
		if (this.expanded) this.expanded = false;
		else await this.expand();
	}

	/** Shows the children, asking the server for them the first time. */
	async expand(): Promise<void> {
		if (!this.expandable) return;
		this.expanded = true;
		if (this.children || this.loading) return;
		this.loading = true;
		this.failed = null;
		const direction = this.tree.direction;
		try {
			const calls = await this.tree.ask(direction, this.row.item);
			// The direction changed while the server answered: this tree is gone.
			if (direction !== this.tree.direction) return;
			if (calls === null) this.failed = 'The language server did not answer.';
			else this.children = toRows(direction, this.row.item, calls, this.ancestors).map((r) => new CallNode(r, [...this.ancestors, this.row.item], this.tree));
		} catch (e) {
			this.failed = e instanceof Error ? e.message : String(e);
		} finally {
			this.loading = false;
		}
	}
}

/** One call hierarchy, of the function `root`, in one direction at a time. */
export class CallHierarchy {
	/** Callers (`incoming`, what VS Code shows first) or callees (`outgoing`). */
	direction = $state<CallDirection>('incoming');
	/** The tree's one top node, the function asked about, expanded; null only while it is made. */
	top = $state.raw<CallNode | null>(null);

	constructor(
		/** The function asked about, as the server's `prepareCallHierarchy` answered it. */
		readonly root: lsp.CallHierarchyItem,
		/** The server's answer for one level; see AskCalls. */
		readonly ask: AskCalls,
		direction: CallDirection = 'incoming',
	) {
		this.show(direction);
	}

	/** Shows the tree in `direction`, asked anew: the same direction again refreshes it. */
	show(direction: CallDirection): void {
		this.direction = direction;
		const top = new CallNode(rootRow(this.root), [], this);
		this.top = top;
		void top.expand();
	}
}
