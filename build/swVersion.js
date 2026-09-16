import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CACHE_LINE = /const CACHE = '[^']*';/;

/**
 * Rewrites the worker's cache name to carry the app version. The worker is
 * cache-first, and a browser only installs a new worker when sw.js is
 * byte-different — so a deploy where nobody remembered to bump CACHE by hand
 * left every installed phone on the old bundle forever. Stamping it from
 * version.json makes each build a new worker without anyone remembering.
 */
export function stampCache(source, version) {
	if (!CACHE_LINE.test(source)) {
		throw new Error('sw.js has no `const CACHE = \'…\';` line to stamp');
	}
	return source.replace(CACHE_LINE, `const CACHE = 'coevta-tasks-${version}';`);
}

// Runs after Vite has copied public/ into dist/, so it edits the copy and
// leaves the source worker alone.
export function swVersionPlugin(version) {
	let outDir;
	return {
		name: 'coevta:sw-version',
		apply: 'build',
		configResolved(config) {
			outDir = config.build.outDir;
		},
		closeBundle() {
			const file = join(outDir, 'sw.js');
			writeFileSync(file, stampCache(readFileSync(file, 'utf8'), version));
		},
	};
}
