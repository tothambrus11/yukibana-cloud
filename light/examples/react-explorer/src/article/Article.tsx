/**
 * The article: prose around the four widgets. Every widget is its own
 * component with its own instance; the page's host (one runner pool, one
 * set of explorer workers) is shared by all of them.
 */
import type { ReactNode } from 'react';
import { useTheme, type ThemeChoice } from '../theme.tsx';
import { CompareWidget } from './CompareWidget.tsx';
import { DebugWidget } from './DebugWidget.tsx';
import { ExploreWidget } from './ExploreWidget.tsx';
import { SanitizerWidget } from './SanitizerWidget.tsx';

/** The colour scheme switch in the masthead. */
function ThemeSwitch(): ReactNode {
	const { choice, choose } = useTheme();
	const options: readonly { readonly value: ThemeChoice; readonly label: string }[] = [
		{ value: 'system', label: 'Auto' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' },
	];
	return (
		<div className="theme-switch" role="radiogroup" aria-label="Colour scheme">
			{options.map((o) => (
				<button key={o.value} type="button" role="radio" aria-checked={choice === o.value} onClick={() => choose(o.value)}>
					{o.label}
				</button>
			))}
		</div>
	);
}

/** The whole page. */
export function Article(): ReactNode {
	return (
		<>
			<header className="masthead">
				<a className="wordmark" href="#top">
					<span aria-hidden="true">▚</span> lowering
				</a>
				<span className="masthead-sub">notes on what compilers do</span>
				<ThemeSwitch />
			</header>
			<main id="top">
				<article>
					<p className="kicker">Systems programming · No. 7</p>
					<h1>What your compiler does with a loop</h1>
					<p className="dek">
						Four small programs, compiled, run and debugged right here in the page. Edit them. Every number below comes from a real compiler running in your browser, not from a
						screenshot.
					</p>

					<h2 id="a-loop-lowered">1. A loop, lowered</h2>
					<p>
						Here is the slowest reasonable way to add up the first <var>n</var> squares. On the right is the WebAssembly that clang makes of it. Point at a line on either side and its
						counterpart lights up: each source line wears its own colour, and so does every instruction it turned into.
					</p>
					<ExploreWidget />
					<p>
						At <code>-O0</code> the loop is there, instruction by instruction: load <code>i</code>, multiply, add, compare, branch. Now switch to <code>-O2</code>. The loop is gone.
						LLVM&rsquo;s scalar evolution recognises <code>total</code> as a polynomial in <var>n</var> and replaces the whole thing with its closed form, a handful of multiplications.
						The note under the editor counts the source lines that had code before and have none now. Switch the view to LLVM IR to see the same story one level up, before the
						backend.
					</p>

					<h2 id="five-ways">2. The same loop, five ways</h2>
					<p>
						Compilers that share a backend tend to arrive at the same place. Rust and Swift both go through LLVM, but each takes its own road there: Rust through MIR, Swift
						through SIL. Python compiles too, to bytecode for its interpreter. JavaScript is compiled as well, by the engine, while it runs, where we cannot see it. Open each
						tab, run it, and compare what each one printed and how much each compiler emitted.
					</p>
					<CompareWidget />
					<p>
						Try Rust at <code>opt-level 0</code> and then at <code>3</code>: the checked arithmetic that panics on overflow in a debug build is the bulk of the difference.
					</p>

					<h2 id="watching-it-run">3. Watching it run</h2>
					<p>
						Reading assembly tells you what the machine will do; a debugger shows you what it did. This is LLDB, compiled to WebAssembly, attached to the program through a stub
						the runner puts at every statement. There is a breakpoint on line 6. Press Debug, then step through the inner loop and watch <code>key</code> and <code>j</code> in
						the locals.
					</p>
					<DebugWidget />

					<h2 id="when-memory-goes-wrong">4. When memory goes wrong</h2>
					<p>
						WebAssembly&rsquo;s memory is one flat array, so writing past the end of a heap block usually corrupts something else quietly. This program writes five
						<code>int</code>s into room for four, and without help it exits as if nothing happened. Turn on AddressSanitizer and run it again: clang instruments every store, and
						the runtime stops the program at the bad one, with the line that did it. (The widget compiles at <code>-O0</code>: at <code>-O2</code> clang forwards the stores straight to
						the load, deletes the allocation, and the bug with it.)
					</p>
					<SanitizerWidget />

					<footer className="colophon">
						<h2>How this page works</h2>
						<p>
							The widgets are React components over a few hooks (<code>useInstance</code>, <code>useRun</code>, <code>useExplore</code>, <code>useDebug</code>) built on the
							embeddable Yukibana packages. Each widget has an instance of <code>@yukibana/core</code> that knows only its languages; all of them borrow one host, so the page
							has one runner per language and one compiler explorer per toolchain however many widgets use them. The compilers, LLDB and the sanitizer runtimes are static files,
							fetched the first time a widget needs them.
						</p>
					</footer>
				</article>
			</main>
		</>
	);
}
