import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

const pkg = JSON.parse(readFileSync(new URL('./version.json', import.meta.url), 'utf8'));

export default defineConfig({
	plugins: [vue()],
	// Mirrors the Vite define so tests resolve the version the same way the app does.
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
	},
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	test: {
		environment: 'jsdom',
		globals: false,
		include: ['tests/**/*.test.js'],
	},
});
