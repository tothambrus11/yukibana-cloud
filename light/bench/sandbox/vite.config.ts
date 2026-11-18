// Two pages, built once and served from two sites by bench.mjs: the page
// (index.html) and the frame its workers live in when framed (frame.html).
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
	resolve: { conditions: ['@yukibana/source', ...defaultClientConditions] },
	worker: { format: 'es' },
	build: {
		target: 'es2024',
		rollupOptions: { input: { index: fileURLToPath(new URL('index.html', import.meta.url)), frame: fileURLToPath(new URL('frame.html', import.meta.url)) } },
	},
	server: { fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../../modules', import.meta.url))] } },
});
