/**
 * Providers: one implementation of a token for one subject (a language or an
 * editor kind), with when it is available and how its body loads.
 *
 * A provider is plain data until it is performed: `available` is pure and
 * cheap, and its body is either imported with it (`eager`) or loaded on first
 * use (`lazy`), so that a host can know what a language offers without
 * downloading what it does.
 */

import type { LanguageKey } from './brand.ts';
import type { EditorKind } from './editor-port.ts';
import type { ProjectSnapshot } from './project.ts';
import type { AnyToken, Token } from './token.ts';

/** What a provider serves: a language, or a kind of editor. */
export type Subject =
	| {
			/** A language an instance knows. */
			readonly kind: 'language';
			/** Its key. */
			readonly id: LanguageKey;
	  }
	| {
			/** A kind of editor (a grammar, a view of it). */
			readonly kind: 'editor';
			/** The kind. */
			readonly id: EditorKind;
	  };

/**
 * Whether something can be done for a project now, and if not, why not, as a
 * sentence a host shows beside the button it disables.
 */
export type Availability =
	| {
			/** It can. */
			readonly kind: 'available';
	  }
	| {
			/** It cannot. */
			readonly kind: 'unavailable';
			/** Why, as a sentence ("Debugging needs a WebAssembly target."). */
			readonly reason: string;
	  };

/** The availability that says yes, shared, since it carries nothing. */
export const AVAILABLE: Availability = { kind: 'available' };

/**
 * What a provider does when performed: given its input and the context of
 * the call, returns its result.
 */
export type Perform<I, R, H> = (input: I, context: Context<H>) => R;

/** A provider's implementation, imported with it or loaded on first use. */
export type Body<I, R, H> =
	| {
			/** Imported with the provider (Light's run, test and current language: no chunk before a first Run). */
			readonly kind: 'eager';
			/** The implementation. */
			readonly perform: Perform<I, R, H>;
	  }
	| {
			/** Loaded on first use, by `load` (an `import()` thunk). */
			readonly kind: 'lazy';
			/**
			 * Returns the implementation. An instance calls it at most once at a
			 * time and keeps what it resolves to; a rejection is not kept, so the
			 * next use calls it again.
			 */
			readonly load: () => Promise<Perform<I, R, H>>;
	  };

/** Where a provider is filed among its token's providers for one subject. */
export type Entry =
	| {
			/** The token's one provider for the subject (a token of cardinality `'one'`). */
			readonly kind: 'one';
	  }
	| {
			/** One of the token's providers for the subject (a token of cardinality `'many'`). */
			readonly kind: 'many';
			/** Its key among them (`'catch2'`, `'cmake'`), what a property or detector picks. */
			readonly key: string;
			/** Its name as a person reads it (`'Catch2'`, `'CMake'`). */
			readonly label: string;
	  };

/** The entry of a provider of a token of cardinality `'many'`. */
export type ManyEntry = Extract<Entry, { readonly kind: 'many' }>;

/**
 * One implementation of `token` for `subject`, taking an `I` and giving an
 * `R`, with a host of type `H`.
 *
 * Invariant: `entry.kind` is `token.cardinality` (`createInstance` refuses
 * otherwise); `available` reads nothing but the snapshot it is given.
 */
export interface Provider<I, R, H> {
	/** The token it implements. */
	readonly token: Token<I, R>;
	/** What it serves. */
	readonly subject: Subject;
	/** Where it is filed among the token's providers for the subject. */
	readonly entry: Entry;
	/**
	 * The tokens that must be available for the same subject for this one to
	 * be: "mutation testing only where there are tests" is `requires: [test]`.
	 */
	readonly requires: readonly AnyToken[];
	/** Returns whether it can be performed on the project `snapshot`; pure and cheap. */
	readonly available: (snapshot: ProjectSnapshot) => Availability;
	/** Its implementation. */
	readonly body: Body<I, R, H>;
}

/**
 * Any provider for a host of type `H`, whatever its token: what an instance
 * is made from. A `Provider<I, R, H>` is one.
 */
export interface AnyProvider<H> {
	/** The token it implements. */
	readonly token: AnyToken;
	/** What it serves. */
	readonly subject: Subject;
	/** Where it is filed among the token's providers for the subject. */
	readonly entry: Entry;
	/** The tokens that must be available for the same subject for this one to be. */
	readonly requires: readonly AnyToken[];
	/** Returns whether it can be performed on the project `snapshot`. */
	readonly available: (snapshot: ProjectSnapshot) => Availability;
	/** Its implementation, of an input only its token knows. */
	readonly body: Body<never, unknown, H>;
}

/**
 * Returns `provider` itself: written around a provider's literal so that its
 * `I`, `R` and `H` are inferred from its token and checked against its body.
 */
export function provide<I, R, H>(provider: Provider<I, R, H>): Provider<I, R, H> {
	return provider;
}

/** What a provider's body is performed with besides its input. */
export interface Context<H> {
	/** What the host lends every provider (a page's runner pool, its pack locator). */
	readonly host: H;
	/** The project as it was when the caller asked. */
	readonly snapshot: ProjectSnapshot;
	/** Aborted when the caller no longer wants the result; a body may stop early, or finish. */
	readonly signal: AbortSignal;
}
