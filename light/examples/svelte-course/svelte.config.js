// Svelte's options for the course's components: TypeScript in <script lang="ts">,
// stripped by Vite's own transform (vitePreprocess), so components are held to
// the same tsconfig as the rest of src/.
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default { preprocess: vitePreprocess() };
