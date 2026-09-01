import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

const pkg = JSON.parse(readFileSync(new URL('./version.json', import.meta.url), 'utf8'));

// Where the coevta server is listening in development. `composer dev` in
// ../server runs `artisan serve --port=8040`; override with VITE_SERVER_URL in
// .env.local if you run it somewhere else.
const DEFAULT_SERVER_URL = 'http://127.0.0.1:8040';

export default defineConfig(({ mode }) => ({
	plugins: [vue()],
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
	},
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	build: {
		// The service worker precaches a literal list of shell assets, so bundle
		// filenames must stay stable across builds — no content hashes.
		rollupOptions: {
			output: {
				entryFileNames: 'assets/[name].js',
				chunkFileNames: 'assets/[name].js',
				assetFileNames: 'assets/[name][extname]',
				// One bundle, not per-route chunks. A chunk that is not in the
				// precache list is a route that fails offline, and keeping a
				// generated list in sync with a hand-written service worker is
				// exactly the kind of thing nobody remembers to do.
				manualChunks: () => 'index',
			},
		},
	},
	server: {
		port: 8043,
		strictPort: true,
		proxy: {
			// The app calls /api/v1/* relatively, so in production it is served
			// from the server's own origin and no proxy exists. In development
			// this stands in for that, which also keeps the browser same-origin.
			'/api': {
				target: loadEnv(mode, process.cwd(), '').VITE_SERVER_URL || DEFAULT_SERVER_URL,
				changeOrigin: true,
			},
		},
	},
}));
