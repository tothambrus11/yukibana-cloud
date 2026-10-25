/**
 * What a pack's workers need from the page that starts them, and whether a
 * page has it, decided from values alone before anything is downloaded.
 *
 * A pack ships its needs as data (`requires` in its pack.json, or inline
 * beside a worker a host bundled itself), and this module only reads and
 * compares them: it names no pack, and a pack nobody here has heard of (the
 * Hylo site's, a teacher's) is checked exactly like Light's own. A need
 * says what the *host* must provide, never how the pack works inside, so a
 * pack that stops needing something drops it with no change of format
 * (D21 in the architecture plan).
 *
 * A session asks, in this order, before it creates a worker or fetches a
 * byte: {@link protocolProblem}, with the major the pack says it was built
 * for; then {@link parseRequires} on its needs; then {@link needFor}, for
 * what it is about to start; then {@link requirementProblem}. A problem at
 * any step is shown by its `reason` (a parse's by its `problems`) and
 * nothing is started. The protocol comes first because a pack of another
 * major may declare its needs in a shape this copy cannot read, and its
 * reader should be told the page is older than the pack, not shown the
 * parser's complaint about a field it has never heard of.
 */
import type { RunMode } from './runner.ts';

/**
 * The major version of the protocol this copy of the module speaks: the
 * messages to and from a pack's workers and the shape of what a pack
 * declares. A pack says which major it was built for (pack.json
 * `protocol`), and a page refuses a pack of another major by name
 * ({@link protocolProblem}) rather than reading its needs or starting a
 * worker that would misread it. It changes only when a change breaks a page or a pack of the
 * previous major; anything optional a receiver may ignore keeps it.
 *
 * It is not the npm version of @yukibana/protocol, which is unversioned
 * (0.0.0, private) until the package is published; from then on, a new
 * major here is a new major there too.
 */
export const PROTOCOL_MAJOR = 1;

/**
 * Whether a worker needs the page to be cross-origin isolated, from least
 * to most demanding:
 *
 * - `no`: it never looks.
 * - `optional-stdin`: it runs either way, but standard input reaches the
 *   program only on an isolated page; elsewhere every read is end of file
 *   (stdin.ts says why: the input buffer is a SharedArrayBuffer).
 *   {@link requirementLimitation} says so in a sentence a host can show.
 * - `required`: it cannot start at all on a page that is not isolated
 *   (C++'s threaded clangd, a Linux machine emulated with threads).
 */
export type Isolation = 'no' | 'optional-stdin' | 'required';

/** The values of {@link Isolation}, least demanding first; the order is what "stricter" means. */
const ISOLATION: readonly Isolation[] = ['no', 'optional-stdin', 'required'];

/** What one worker, doing one thing, needs from its host. */
export interface Need {
	crossOriginIsolated: Isolation;
	/**
	 * true: the pack must be served from the origin of the context that
	 * starts the worker, because the worker starts further workers from
	 * the pack's own URL, and a context may start a worker only from its
	 * own origin. A cross-origin pack goes through a blob trampoline
	 * (packs.ts in the runtime), which covers the first worker and not the
	 * ones it starts. Inside the runner frame the packs are on the frame's
	 * origin, so it is always met there.
	 */
	sameOriginPacks: boolean;
}

/**
 * The kinds of worker a pack may have: a language server, a runner (which
 * also builds the JavaScript pack's previews), and an explorer that shows
 * compiler output (packs/CONTRACT.md, "Showing compiler output").
 */
export type WorkerKind = 'lsp' | 'runner' | 'explorer';

/** The worker kinds, in the order a problem names them. */
const WORKER_KINDS: readonly WorkerKind[] = ['lsp', 'runner', 'explorer'];

/** The requests a runner is sent ({@link RunMode}), for checking a declared one. */
const RUN_MODES: readonly RunMode[] = ['run', 'test', 'mutate'];

/** A worker that does one thing: what it needs whatever it is asked. */
export interface SingleNeeds {
	default: Need;
}

/**
 * What a runner needs, by what it is asked to do and for which target. A
 * request or target lists only what it needs beyond `default`, and only
 * when it does; one not listed needs what `default` says. An entry can
 * only add to `default`, never relax it ({@link needFor} takes the
 * stricter of each field), so a field an entry leaves out means "as
 * `default`".
 */
export interface RunnerNeeds {
	default: Need;
	/** By request: e.g. mutation testing, which starts a worker per mutant. */
	requests?: Partial<Record<RunMode, Partial<Need>>>;
	/** By target, as the pack names its targets: e.g. a C++ program built for Linux, run on an emulated machine. */
	targets?: Record<string, Partial<Need>>;
}

/**
 * Everything a pack (or a host-built worker) declares it needs, per
 * worker. A worker the pack does not have is absent, and a page asking
 * for it is refused by name ({@link requirementProblem}); absent never
 * means "needs nothing".
 */
export interface Requires {
	lsp?: SingleNeeds;
	runner?: RunnerNeeds;
	explorer?: SingleNeeds;
}

/**
 * What {@link parseRequires} read: the needs, or every problem with them,
 * each a sentence naming the field (`runner.targets.linux.sameOriginPacks
 * is "yes", not true or false`).
 */
export type ParsedRequires = { ok: true; requires: Requires } | { ok: false; problems: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isIsolation = (value: unknown): value is Isolation => ISOLATION.some((level) => level === value);
const isWorkerKind = (value: string): value is WorkerKind => WORKER_KINDS.some((kind) => kind === value);
const isRunMode = (value: string): value is RunMode => RUN_MODES.some((mode) => mode === value);
/** A value as a problem quotes it: short, and never the whole of something large. */
const quote = (value: unknown): string => {
	const text = JSON.stringify(value) ?? String(value);
	return text.length > 40 ? `${text.slice(0, 37)}...` : text;
};

/**
 * Reads one need at `path`. A `default` must state both fields (`whole`);
 * a request's or target's may state either, but not neither, since an
 * entry that adds nothing is a mistake about what it was meant to add.
 * Unknown fields are problems, not ignored: a misspelt
 * `crossOriginIsolation` would otherwise read as "needs nothing".
 */
function readNeed(value: unknown, path: string, whole: boolean, problems: string[]): Partial<Need> {
	if (!isRecord(value)) {
		problems.push(`${path} is ${quote(value)}, not an object`);
		return {};
	}
	const need: Partial<Need> = {};
	for (const [key, field] of Object.entries(value)) {
		if (key === 'crossOriginIsolated') {
			if (isIsolation(field)) need.crossOriginIsolated = field;
			else problems.push(`${path}.crossOriginIsolated is ${quote(field)}, not one of ${ISOLATION.map(quote).join(', ')}`);
		} else if (key === 'sameOriginPacks') {
			if (typeof field === 'boolean') need.sameOriginPacks = field;
			else problems.push(`${path}.sameOriginPacks is ${quote(field)}, not true or false`);
		} else {
			problems.push(`${path} has '${key}', which is not a need (crossOriginIsolated, sameOriginPacks)`);
		}
	}
	if (whole) {
		for (const key of ['crossOriginIsolated', 'sameOriginPacks'] as const) {
			if (!(key in value)) problems.push(`${path} does not say ${key}; a default states both`);
		}
	} else if (Object.keys(value).length === 0) {
		problems.push(`${path} is empty; leave it out when it needs nothing beyond the default`);
	}
	return need;
}

/** Reads a map of names to partial needs (a runner's `requests` or `targets`) at `path`. */
function readEntries(
	value: unknown,
	path: string,
	nameProblem: (name: string) => string | null,
	problems: string[],
): Record<string, Partial<Need>> {
	if (!isRecord(value)) {
		problems.push(`${path} is ${quote(value)}, not an object`);
		return {};
	}
	const entries: [string, Partial<Need>][] = [];
	for (const [name, need] of Object.entries(value)) {
		const wrong = nameProblem(name);
		if (wrong !== null) problems.push(`${path} has ${quote(name)}, ${wrong}`);
		else entries.push([name, readNeed(need, `${path}.${name}`, false, problems)]);
	}
	// fromEntries defines own properties, so a target called "__proto__" is
	// data like any other name rather than the object's prototype.
	return Object.fromEntries(entries);
}

/** A need that states both fields, or null when one is missing (already named as a problem). */
const whole = ({ crossOriginIsolated, sameOriginPacks }: Partial<Need>): Need | null =>
	crossOriginIsolated !== undefined && sameOriginPacks !== undefined ? { crossOriginIsolated, sameOriginPacks } : null;

/**
 * Reads the fields of a worker's entry other than `default`: a runner's
 * `requests` and `targets`, and for any other worker nothing, since only a
 * runner is asked different things.
 */
function readOthers(worker: WorkerKind, entry: Record<string, unknown>, problems: string[]): Omit<RunnerNeeds, 'default'> {
	const others: Omit<RunnerNeeds, 'default'> = {};
	for (const [field, value] of Object.entries(entry)) {
		if (field === 'default') continue;
		if (field === 'crossOriginIsolated' || field === 'sameOriginPacks') {
			problems.push(`${worker} has '${field}' itself; a need goes under ${worker}.default`);
		} else if (worker !== 'runner') {
			problems.push(`${worker} has '${field}', but only a runner's needs vary by request or target`);
		} else if (field === 'requests') {
			others.requests = readEntries(
				value,
				'runner.requests',
				(name) => (isRunMode(name) ? null : `which is not a request a runner is sent (${RUN_MODES.join(', ')})`),
				problems,
			);
		} else if (field === 'targets') {
			others.targets = readEntries(value, 'runner.targets', (name) => (name === '' ? 'an empty target name' : null), problems);
		} else {
			problems.push(`runner has '${field}', which is not default, requests or targets`);
		}
	}
	return others;
}

/**
 * Reads what a pack declares it needs, from JSON or an inline object, and
 * never throws. Every problem is collected, so a pack's author sees all of
 * them at once. Anything not part of the format is a problem rather than
 * ignored, because a need nobody reads is a need nobody meets: a host would
 * start the worker and it would fail later, with a worse reason. A new
 * field therefore comes with a new {@link PROTOCOL_MAJOR}, or is added here
 * before any pack declares it. That is why a caller asks
 * {@link protocolProblem} first: a newer pack's needs are the very thing
 * this may fail to read, and its reader is owed the protocol's reason.
 */
export function parseRequires(value: unknown): ParsedRequires {
	const problems: string[] = [];
	if (!isRecord(value)) return { ok: false, problems: [`requires is ${quote(value)}, not an object`] };
	const requires: Requires = {};
	for (const [key, entry] of Object.entries(value)) {
		if (!isWorkerKind(key)) {
			problems.push(`requires has '${key}', which is not a kind of worker (${WORKER_KINDS.join(', ')})`);
			continue;
		}
		if (!isRecord(entry)) {
			problems.push(`${key} is ${quote(entry)}, not an object`);
			continue;
		}
		const need = 'default' in entry ? whole(readNeed(entry['default'], `${key}.default`, true, problems)) : null;
		if (!('default' in entry)) problems.push(`${key} has no default need`);
		// A default with a problem has been named; what follows only collects more.
		if (need === null) {
			readOthers(key, entry, problems);
			continue;
		}
		if (key === 'runner') requires.runner = { default: need, ...readOthers(key, entry, problems) };
		else {
			readOthers(key, entry, problems);
			requires[key] = { default: need };
		}
	}
	if (problems.length === 0 && Object.keys(requires).length === 0) {
		problems.push('requires names no worker; a pack has at least one of lsp, runner, explorer');
	}
	return problems.length === 0 ? { ok: true, requires } : { ok: false, problems };
}

/**
 * What a runner is about to be asked: `request` (absent for a preview,
 * which takes the default) and the program's `target`, when the pack has
 * more than one.
 */
export interface RunnerCall {
	request?: RunMode;
	target?: string;
}

/** `need` with each field of `more` that is stricter than its own. */
function stricter(need: Need, more: Partial<Need> | undefined): Need {
	if (more === undefined) return need;
	const isolation = more.crossOriginIsolated;
	return {
		crossOriginIsolated:
			isolation !== undefined && ISOLATION.indexOf(isolation) > ISOLATION.indexOf(need.crossOriginIsolated)
				? isolation
				: need.crossOriginIsolated,
		sameOriginPacks: need.sameOriginPacks || more.sameOriginPacks === true,
	};
}

/** `record[key]` when it is the record's own entry; a name like "constructor" is not a declared one. */
const own = <T>(record: Record<string, T> | undefined, key: string | undefined): T | undefined =>
	record !== undefined && key !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;

/**
 * The need of `worker` in `requires`, for a runner as `call` will ask it:
 * the default, made stricter, field by field, by the request's entry and
 * then the target's. A request or target the pack does not list needs the
 * default. null when the pack has no such worker; {@link
 * requirementProblem} refuses that by name.
 */
export function needFor(requires: Requires, worker: 'lsp' | 'explorer'): Need | null;
export function needFor(requires: Requires, worker: 'runner', call: RunnerCall): Need | null;
export function needFor(requires: Requires, worker: WorkerKind, call: RunnerCall = {}): Need | null {
	if (worker !== 'runner') return requires[worker]?.default ?? null;
	const runner = requires.runner;
	if (runner === undefined) return null;
	return stricter(stricter(runner.default, own(runner.requests, call.request)), own(runner.targets, call.target));
}

/**
 * What a session is about to start, as a problem names it: the pack's
 * name as a reader knows it ("C++", "Hylo"), which of its workers, for
 * which call, and the {@link PROTOCOL_MAJOR} it was built for (pack.json
 * `protocol`; a worker the host bundled itself passes the page's own).
 */
export interface Starting {
	pack: string;
	worker: WorkerKind;
	call?: RunnerCall;
	protocol: number;
}

/**
 * What the context that will start the worker has. That is the page for
 * an in-page worker and the runner frame for a framed transport, so a
 * session asks its transport, not the page.
 */
export interface StartingContext {
	/** Its `crossOriginIsolated`. */
	crossOriginIsolated: boolean;
	/**
	 * Whether the worker's URL is on the context's own origin: a pack served
	 * from the page's origin, a worker the host bundled, or any pack inside
	 * the runner frame (H9). false for packs served from another origin.
	 */
	packsSameOrigin: boolean;
}

/**
 * Why a worker must not be started, with a `reason` a host shows as it
 * is. `protocol`: the pack was built for another major than the page's
 * (`pack` and `page` are the two). `absent`: the pack has no such worker.
 * `unmet`: the context lacks what the need asks for; `missing` names each
 * field, so a host that can fix one (by reloading under an isolating
 * service worker, say) knows which.
 */
export type RequirementProblem =
	| { kind: 'protocol'; reason: string; pack: number; page: number }
	| { kind: 'absent'; reason: string }
	| { kind: 'unmet'; reason: string; missing: (keyof Need)[] };

const WORKER_NAMES: Record<WorkerKind, string> = {
	lsp: 'language server',
	runner: 'runner',
	explorer: 'compiler explorer',
};
const REQUEST_WORDS: Record<RunMode, string> = {
	run: 'to run a program',
	test: 'to run tests',
	mutate: 'to mutation-test',
};

/** "C++'s runner, to run tests for the linux target," as a sentence's subject. */
function subject({ pack, worker, call }: Starting): string {
	const purpose = [
		call?.request !== undefined ? REQUEST_WORDS[call.request] : null,
		call?.target !== undefined ? `for the ${call.target} target` : null,
	].filter((part) => part !== null);
	return `${pack}'s ${WORKER_NAMES[worker]}${purpose.length > 0 ? `, ${purpose.join(' ')},` : ''}`;
}

/**
 * Why a pack built for protocol major `protocol` cannot be used by this
 * page, or null when it is this page's own {@link PROTOCOL_MAJOR}. `pack`
 * is its name as a reader knows it, for the reason. A session asks this
 * before {@link parseRequires}, since nothing else a pack of another major
 * says can be trusted to be in a shape this copy reads; the reason says
 * which side is older and who has to update. It takes a {@link Starting}
 * as it is, or just the pack's name and major.
 */
export function protocolProblem({ pack, protocol }: Pick<Starting, 'pack' | 'protocol'>): RequirementProblem | null {
	if (protocol === PROTOCOL_MAJOR) return null;
	const versions = `(the pack speaks protocol ${protocol}, the page ${PROTOCOL_MAJOR})`;
	return {
		kind: 'protocol',
		pack: protocol,
		page: PROTOCOL_MAJOR,
		reason:
			protocol > PROTOCOL_MAJOR
				? `${pack} cannot start: this page's editor is older than its pack ${versions}. ` +
					"The page's owner needs to update the page's Yukibana modules."
				: `${pack} cannot start: its pack is older than this page's editor ${versions}. ` +
					`Whoever hosts the pack needs to serve a build of it for protocol ${PROTOCOL_MAJOR}.`,
	};
}

/**
 * Why `need` (from {@link needFor}) cannot be met where it would start,
 * or null when it can. Pure: it reads only its arguments, so a session
 * asks it before it creates a worker or fetches anything, and an unmet
 * need costs the reader no download.
 *
 * Checked in this order, the first that applies answering: a pack of
 * another protocol major ({@link protocolProblem}, asked again here so a
 * caller that skipped it still cannot start one), a worker
 * the pack does not have (`need` null), then the need itself, with every
 * unmet field in one reason. `optional-stdin` is never a problem;
 * {@link requirementLimitation} says what it costs.
 */
export function requirementProblem(need: Need | null, starting: Starting, context: StartingContext): RequirementProblem | null {
	const protocol = protocolProblem(starting);
	if (protocol !== null) return protocol;
	if (need === null) {
		return { kind: 'absent', reason: `${starting.pack} has no ${WORKER_NAMES[starting.worker]}.` };
	}
	const missing: (keyof Need)[] = [];
	const sentences: string[] = [];
	if (need.crossOriginIsolated === 'required' && !context.crossOriginIsolated) {
		missing.push('crossOriginIsolated');
		sentences.push(
			'needs a cross-origin isolated page, and this one is not. A page is isolated when it is served with ' +
				'Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp or credentialless, ' +
				'directly or through a service worker that adds them.',
		);
	}
	if (need.sameOriginPacks && !context.packsSameOrigin) {
		missing.push('sameOriginPacks');
		sentences.push(
			`${missing.length > 1 ? 'It also needs' : 'needs'} its pack served from the origin of the page that starts it, and it is served from another. ` +
				"It starts where the pack is on the page's own origin, or inside the runner frame.",
		);
	}
	if (missing.length === 0) return null;
	return { kind: 'unmet', missing, reason: `${subject(starting)} ${sentences.join(' ')}` };
}

/**
 * What a met `need` still cannot do where it would start, as a sentence a
 * host shows beside the program, or null when nothing. Today that is one
 * case: standard input on a context that is not cross-origin isolated,
 * where the program runs but every read is end of file.
 */
export function requirementLimitation(need: Need, starting: Starting, context: StartingContext): string | null {
	if (need.crossOriginIsolated !== 'optional-stdin' || context.crossOriginIsolated) return null;
	return (
		`${starting.pack}'s programs cannot read what is typed on this page, which is not cross-origin isolated: ` +
		'reading standard input gives end of file.'
	);
}
