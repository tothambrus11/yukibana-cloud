// The runner frame, frame protocol 1: so far only its greeting.
//
// A page of another site embeds this frame, and every worker of a language
// pack will be started here, on the registry's origin, never on the page's
// (REGISTRY-DESIGN.md 5). What exists yet is the first message of that
// protocol: the frame says that it is there, which protocol it speaks, and
// whether it is cross-origin isolated, which decides whether a program can
// read input and whether threaded servers start. Starting workers and
// relaying their messages is stage 1 of PLAN.md.
//
// Opened as a page of its own it does nothing: it has no embedder to answer.
if (window.parent !== window) {
	// To any embedder: the greeting says nothing a page could not see for itself.
	window.parent.postMessage({ type: 'yukibana-frame', protocol: 1, isolated: globalThis.crossOriginIsolated === true }, '*');
}
