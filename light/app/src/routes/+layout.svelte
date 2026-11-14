<script lang="ts">
	// The design system, from the @yukibana/design package (a git dependency,
	// pinned to one commit in package.json): its tokens, its three typefaces
	// (self-hosted from the package, Latin and Latin Extended; licences/app.txt
	// carries their OFL), and the parts of its base styles Light uses. Then
	// Light's own styles, which come after them and win where they differ.
	import '@yukibana/design/tokens.css';
	import '@yukibana/design/fonts.css';
	import '@yukibana/design/css/base/core.css';
	import '@yukibana/design/css/base/buttons.css';
	import '@yukibana/design/css/base/check.css';
	import '@yukibana/design/css/base/segmented.css';
	import '@yukibana/design/css/base/toast.css';
	import '../app.css';

	let { children } = $props();
</script>

{@render children()}
