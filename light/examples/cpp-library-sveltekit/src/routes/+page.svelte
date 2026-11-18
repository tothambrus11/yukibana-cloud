<script lang="ts">
	import CppPlayground from '../lib/CppPlayground.svelte';
	import main from '../cpp/main.cpp?raw';
	import header from '../cpp/lib/include/geometry.h?raw';
	import source from '../cpp/lib/src/geometry.cpp?raw';
</script>

<svelte:head>
	<title>C++ with my library, in SvelteKit</title>
</svelte:head>

<main>
	<h1>C++ with my library</h1>
	<p>
		<code>main.cpp</code> uses the <code>geometry</code> library (<code>lib/</code>, not editable here). Hover over a name, Ctrl+Space, F12
		into the library, break something to see the errors, then Run: the library is compiled and linked with it.
	</p>
	<CppPlayground
		files={{ 'main.cpp': main }}
		hidden={{
			'lib/include/geometry.h': header,
			'lib/src/geometry.cpp': source,
			'compile_flags.txt': '-std=c++20\n-Ilib/include\n',
		}}
	/>
</main>

<style>
	main {
		padding: 16px;
		font-family: system-ui, sans-serif;
	}
</style>
