/**
 * Tokens: typed, nominal names of a capability (run a program, explore its
 * assembly, export a build), which providers implement and an instance
 * answers for.
 *
 * A token's identity is the object `defineToken` returned, never its id: two
 * packages that each define `'@yukibana/std#run'` have two tokens, and an
 * instance that meets both refuses them (`Incoherent`), because a copy of a
 * package loaded twice is a bug that would otherwise find no provider in
 * silence. The id is for messages and that refusal only.
 */

declare const phantom: unique symbol;

/**
 * How many providers a token may have for one subject: `'one'`, which a
 * caller performs, or `'many'`, each provider filed under a key that a
 * property or a detector picks (test frameworks, export build systems).
 */
export type Cardinality = 'one' | 'many';

/**
 * The name of a token, `<package>#<name>` (`'@yukibana/std#run'`).
 *
 * Invariant: exactly one `#`, with text on both sides.
 */
export type TokenId = `${string}#${string}`;

/**
 * Any token, whatever its input and result: what a list of tokens of
 * different types (a provider's `requires`) holds, and what a question that
 * does not perform (`has`, `availability`) takes.
 */
export interface AnyToken<C extends Cardinality = Cardinality> {
	/** The token's name, for messages and the duplicate-id refusal only. */
	readonly id: TokenId;
	/** How many providers it may have for one subject. */
	readonly cardinality: C;
}

/**
 * A capability that takes an `I` and gives an `R`, with `C` providers per
 * subject.
 *
 * Invariant: made by `defineToken`, and equal only to itself. It is
 * invariant in `I`, so a token of one input never stands for a token of
 * another, and covariant in `R`.
 */
export interface Token<I, R, C extends Cardinality = Cardinality> extends AnyToken<C> {
	/** Carries `I` and `R` in the type only; absent at run time. */
	readonly [phantom]: (input: I) => [I, R];
}

/** What `defineToken<I, R>()` returns: the function that makes the token. */
export interface TokenMaker<I, R> {
	/** Returns a new token named `id`, with one provider per subject. */
	<const Id extends TokenId>(id: Id): Token<I, R, 'one'>;
	/** Returns a new token named `id`, with `cardinality` providers per subject. */
	<const Id extends TokenId, const C extends Cardinality>(id: Id, cardinality: C): Token<I, R, C>;
}

/**
 * Returns the function that makes a token of input `I` and result `R`;
 * called as `defineToken<I, R>()('pkg#name')`, with `/* @__PURE__ *\/` at the
 * call site so that a bundler drops a token nobody uses.
 *
 * The maker's result is frozen, and a new object on every call.
 *
 * - Requires (of the maker): `id` has exactly one `#`, with text on both sides.
 */
export function defineToken<I, R>(): TokenMaker<I, R> {
	return (id: TokenId, cardinality: Cardinality = 'one') => {
		if (!/^[^#]+#[^#]+$/.test(id)) throw new RangeError(`"${id}" is not a token id: it is "<package>#<name>".`);
		if (cardinality !== 'one' && cardinality !== 'many') throw new RangeError(`"${String(cardinality)}" is not a cardinality.`);
		// The phantom member exists in the type only, so the object is cast to
		// the token it stands for: the one place a token is made.
		return Object.freeze({ id, cardinality }) as Token<I, R, never>;
	};
}
