/**
 * An instance: the languages and providers one host offers, checked to be
 * coherent once, and asked what can be done for a project and to do it.
 *
 * It holds no global state and creates no workers: two instances on a page
 * are two `createInstance` calls, sharing whatever the host value lends
 * them (the page's runner pool).
 */

import type { LanguageMeta } from './language.ts';
import type { ProjectSnapshot } from './project.ts';
import { AVAILABLE, type AnyProvider, type Availability, type Context, type ManyEntry, type Perform, type Subject } from './provider.ts';
import type { AnyToken, Token } from './token.ts';

/**
 * Thrown by `createInstance` when its languages or providers contradict each
 * other; the message names both sides.
 */
export class Incoherent extends Error {
	override name = 'Incoherent';
}

/** What performing a token gave: its result, or why it could not be performed. */
export type Outcome<R> =
	| {
			/** It was performed. */
			readonly kind: 'done';
			/** What it gave. */
			readonly value: R;
	  }
	| {
			/** It was not, and nothing was loaded or started. */
			readonly kind: 'unavailable';
			/** Why, as `availability` says it. */
			readonly reason: string;
	  };

/** One host's languages and providers, answering for them. */
export interface Instance<H> {
	/** Every language, in the order the host gave them. */
	readonly languages: readonly LanguageMeta[];
	/**
	 * Returns the language whose key is `id`, or null when the instance has
	 * none: the one place a string from outside becomes a language.
	 */
	languageOf(id: string): LanguageMeta | null;
	/**
	 * `true` iff `subject` has a provider of `token` whose required tokens it
	 * has too, transitively. Loads nothing and reads no project.
	 */
	has(subject: Subject, token: AnyToken): boolean;
	/**
	 * Returns whether `token` can be performed for `subject` on `snapshot`:
	 * unavailable when there is no provider, else the first unavailable of the
	 * provider's required tokens, in order, else the provider's own answer.
	 * For a `'many'` token, available iff some entry is; else the first
	 * entry's reason.
	 */
	availability(subject: Subject, token: AnyToken, snapshot: ProjectSnapshot): Availability;
	/**
	 * Performs `token` for `subject` on `snapshot` with `input`, loading its
	 * body if it is lazy; `unavailable` (loading nothing) when `availability`
	 * says so. Rejects with what the body's load or the body threw.
	 *
	 * - Requires: `token.cardinality` is `'one'`.
	 */
	perform<I, R>(subject: Subject, token: Token<I, R, 'one'>, input: I, snapshot: ProjectSnapshot, signal: AbortSignal): Promise<Outcome<R>>;
	/** Returns the entries of the providers of `token` that `subject` has, in the host's order. */
	entries(subject: Subject, token: AnyToken<'many'>): readonly ManyEntry[];
	/**
	 * Returns whether the provider of `token` keyed `key` can be performed for
	 * `subject` on `snapshot`, as `availability` answers for a `'one'` token:
	 * unavailable when there is no such provider, else the first unavailable
	 * of its required tokens, else its own answer. The per-key twin of
	 * `performKey`, which performs exactly when this is available.
	 *
	 * - Requires: `token.cardinality` is `'many'`.
	 */
	availabilityOf(subject: Subject, token: AnyToken<'many'>, key: string, snapshot: ProjectSnapshot): Availability;
	/**
	 * Performs the provider of `token` keyed `key` for `subject`, as `perform`
	 * does; `unavailable` when there is none.
	 *
	 * - Requires: `token.cardinality` is `'many'`.
	 */
	performKey<I, R>(subject: Subject, token: Token<I, R, 'many'>, key: string, input: I, snapshot: ProjectSnapshot, signal: AbortSignal): Promise<Outcome<R>>;
}

/** What an instance is made from. */
export interface InstanceConfig<H> {
	/** Its languages; no two with one key. */
	readonly languages: readonly LanguageMeta[];
	/** Its providers; see `createInstance` for what may not meet. */
	readonly providers: readonly AnyProvider<H>[];
	/** What every provider's body is lent. */
	readonly host: H;
}

/** A provider as an instance keeps it: with its body's load, shared while in flight. */
interface Filed<H> {
	readonly provider: AnyProvider<H>;
	/** Where it is in the host's list, for messages. */
	readonly index: number;
	/** The body once loaded, or its load while in flight; null before either, and after a load failed. */
	loaded: Perform<never, unknown, H> | Promise<Perform<never, unknown, H>> | null;
}

/** A string that is the same for two equal subjects. */
function subjectKey(subject: Subject): string {
	return `${subject.kind}:${subject.id}`;
}

/** A subject as a message names it. */
function describe(subject: Subject): string {
	return `${subject.kind} ${subject.id}`;
}

/** Returns why there is nothing for `token` and `subject`, as a sentence. */
function unprovided(subject: Subject, token: AnyToken): string {
	return `Nothing provides ${token.id} for the ${describe(subject)}.`;
}

/**
 * Returns an instance of `config`'s languages and providers. Throws
 * `Incoherent`, naming both sides, when two languages have one key, two
 * different tokens have one id, a provider's entry does not match its
 * token's cardinality, two providers of a `'one'` token serve one subject,
 * two providers of a `'many'` token for one subject have one key, a
 * language provider serves a language the instance does not have, or
 * providers require each other in a cycle.
 */
export function createInstance<H>(config: InstanceConfig<H>): Instance<H> {
	const languages = new Map<string, LanguageMeta>();
	for (const language of config.languages) {
		if (languages.has(language.key)) throw new Incoherent(`Two languages have the key "${language.key}".`);
		languages.set(language.key, language);
	}

	const tokens = new Map<string, AnyToken>();
	const sameId = (token: AnyToken, where: string): void => {
		const known = tokens.get(token.id);
		if (known === undefined) tokens.set(token.id, token);
		else if (known !== token) throw new Incoherent(`Two different tokens are named ${token.id} (the second in ${where}): a package is loaded twice.`);
	};

	/** Per token, per subject, its providers in the host's order. */
	const filed = new Map<AnyToken, Map<string, Filed<H>[]>>();
	config.providers.forEach((provider, index) => {
		const where = `providers[${index}]`;
		sameId(provider.token, where);
		for (const required of provider.requires) sameId(required, `the requires of ${where}`);
		if (provider.entry.kind !== provider.token.cardinality) {
			throw new Incoherent(`${where} is filed as "${provider.entry.kind}", but ${provider.token.id} has cardinality "${provider.token.cardinality}".`);
		}
		if (provider.subject.kind === 'language' && !languages.has(provider.subject.id)) {
			throw new Incoherent(`${where} provides ${provider.token.id} for the ${describe(provider.subject)}, which the instance does not have.`);
		}
		const bySubject = filed.get(provider.token) ?? new Map<string, Filed<H>[]>();
		filed.set(provider.token, bySubject);
		const key = subjectKey(provider.subject);
		const others = bySubject.get(key) ?? [];
		bySubject.set(key, others);
		for (const other of others) {
			const entry = provider.entry;
			const otherEntry = other.provider.entry;
			if (entry.kind === 'one') {
				throw new Incoherent(`providers[${other.index}] and ${where} both provide ${provider.token.id} for the ${describe(provider.subject)}, which takes one.`);
			}
			if (otherEntry.kind === 'many' && otherEntry.key === entry.key) {
				throw new Incoherent(`providers[${other.index}] and ${where} both provide ${provider.token.id} for the ${describe(provider.subject)} as "${entry.key}".`);
			}
		}
		others.push({ provider, index, loaded: null });
	});

	const providersOf = (subject: Subject, token: AnyToken): readonly Filed<H>[] => filed.get(token)?.get(subjectKey(subject)) ?? [];

	// A cycle of requires would make `has` and `availability` recurse for
	// ever, so it is refused here, once.
	for (const [token, bySubject] of filed) {
		for (const providers of bySubject.values()) {
			const subject = providers[0]?.provider.subject;
			if (subject === undefined) continue;
			const walk = (at: AnyToken, path: readonly AnyToken[]): void => {
				if (path.includes(at)) throw new Incoherent(`For the ${describe(subject)}, ${[...path, at].map((t) => t.id).join(' requires ')}.`);
				for (const { provider } of providersOf(subject, at)) for (const required of provider.requires) walk(required, [...path, at]);
			};
			walk(token, []);
		}
	}

	const hasProvider = (subject: Subject, provider: AnyProvider<H>): boolean => provider.requires.every((required) => has(subject, required));
	const has = (subject: Subject, token: AnyToken): boolean => providersOf(subject, token).some(({ provider }) => hasProvider(subject, provider));

	const availabilityOf = (subject: Subject, provider: AnyProvider<H>, snapshot: ProjectSnapshot): Availability => {
		for (const required of provider.requires) {
			const answer = availability(subject, required, snapshot);
			if (answer.kind === 'unavailable') return answer;
		}
		return provider.available(snapshot);
	};
	const availability = (subject: Subject, token: AnyToken, snapshot: ProjectSnapshot): Availability => {
		const providers = providersOf(subject, token);
		let first: Availability | null = null;
		for (const { provider } of providers) {
			const answer = availabilityOf(subject, provider, snapshot);
			if (answer.kind === 'available') return AVAILABLE;
			first ??= answer;
		}
		return first ?? { kind: 'unavailable', reason: unprovided(subject, token) };
	};

	/**
	 * Returns the body of `entry`, loading it if it is lazy: one load at a
	 * time, kept once it resolves, forgotten if it rejects.
	 */
	const bodyOf = async (entry: Filed<H>): Promise<Perform<never, unknown, H>> => {
		const body = entry.provider.body;
		if (body.kind === 'eager') return body.perform;
		if (entry.loaded !== null) return entry.loaded;
		const loading = body.load().then(
			(perform) => {
				entry.loaded = perform;
				return perform;
			},
			(error: unknown) => {
				entry.loaded = null;
				throw error;
			},
		);
		entry.loaded = loading;
		return loading;
	};

	const keyed = (subject: Subject, token: AnyToken, key: string): Filed<H> | undefined =>
		providersOf(subject, token).find(({ provider }) => provider.entry.kind === 'many' && provider.entry.key === key);
	const unkeyed = (subject: Subject, token: AnyToken, key: string): string => `Nothing provides ${token.id} as "${key}" for the ${describe(subject)}.`;

	const run = async <I, R>(subject: Subject, entry: Filed<H> | undefined, input: I, snapshot: ProjectSnapshot, signal: AbortSignal, missing: string): Promise<Outcome<R>> => {
		if (entry === undefined) return { kind: 'unavailable', reason: missing };
		const answer = availabilityOf(subject, entry.provider, snapshot);
		if (answer.kind === 'unavailable') return answer;
		const perform = await bodyOf(entry);
		const context: Context<H> = { host: config.host, snapshot, signal };
		// The provider was filed under the token the caller passed, and
		// `provide` checked its body against that token's input and result:
		// the one place the instance forgets, then recalls, a provider's types.
		const value = (perform as unknown as Perform<I, R, H>)(input, context);
		return { kind: 'done', value };
	};

	return {
		languages: config.languages,
		languageOf: (id) => languages.get(id) ?? null,
		has,
		availability,
		perform: (subject, token, input, snapshot, signal) => {
			if (token.cardinality !== 'one') throw new RangeError(`${token.id} has many providers: performKey picks one.`);
			return run(subject, providersOf(subject, token)[0], input, snapshot, signal, unprovided(subject, token));
		},
		entries: (subject, token) => {
			const found: ManyEntry[] = [];
			for (const { provider } of providersOf(subject, token)) {
				if (provider.entry.kind === 'many' && hasProvider(subject, provider)) found.push(provider.entry);
			}
			return found;
		},
		availabilityOf: (subject, token, key, snapshot) => {
			if (token.cardinality !== 'many') throw new RangeError(`${token.id} has one provider: availability answers for it.`);
			const entry = keyed(subject, token, key);
			return entry === undefined ? { kind: 'unavailable', reason: unkeyed(subject, token, key) } : availabilityOf(subject, entry.provider, snapshot);
		},
		performKey: (subject, token, key, input, snapshot, signal) => {
			if (token.cardinality !== 'many') throw new RangeError(`${token.id} has one provider: perform performs it.`);
			return run(subject, keyed(subject, token, key), input, snapshot, signal, unkeyed(subject, token, key));
		},
	};
}
