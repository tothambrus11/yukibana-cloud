<script lang="ts">
	// The design system's three families, self-hosted from npm like the editor's
	// font always was (licences/app.txt lists them): Bricolage Grotesque with its
	// optical-size axis, as the design system's reference page loads it.
	import '@fontsource-variable/atkinson-hyperlegible-next';
	import '@fontsource-variable/bricolage-grotesque/opsz.css';
	import '@fontsource-variable/jetbrains-mono';
	// The design system's tokens and the parts of its base styles Light uses, then Light's own.
	import '../design/tokens.css';
	import '../design/base.css';
	import '../app.css';

	let { children } = $props();
</script>

{@render children()}
