import os from 'node:os';
import path from 'node:path';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: adapter()
		})
	],
	test: {
		include: ['src/**/*.test.ts'],
		// Tests get a throwaway data folder; each test file clears it as needed.
		env: { SEREBRO_DATA_DIR: path.join(os.tmpdir(), `serebro-test-${process.pid}`) },
		fileParallelism: false
	}
});
