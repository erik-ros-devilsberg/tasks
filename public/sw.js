/*
 * Hand-written, not generated.
 *
 * Maintenance rule: adding a shell asset means adding it to SHELL. addAll is
 * atomic — one stale entry fails the whole install, and a failed install
 * means no offline app at all.
 *
 * CACHE is stamped with the app version at build time (build/swVersion.js),
 * never bumped by hand. The browser only installs a new worker when this file
 * changes, so a hand-bumped name that got forgotten once left every phone on
 * the old bundle. The '-dev' name below is what the source ships with and
 * what a build must never contain. Only /agile:commit bumps version.json, so
 * a commit made by hand ships a build that phones never pick up.
 *
 * main.css only @imports its parts, so every part is listed individually. The
 * bundle is listed by a fixed name, which is why vite.config.js turns off
 * content hashing and emits a single chunk: a filename this list cannot predict
 * is a route that fails offline.
 */

const CACHE = 'coevta-tasks-dev';

const SHELL = [
	'/',
	'/index.html',
	'/manifest.webmanifest',
	'/icon.svg',
	'/icon-maskable.svg',
	'/icon-192.png',
	'/icon-512.png',
	'/icon-maskable-512.png',
	'/apple-touch-icon.png',
	'/css/main.css',
	'/css/fonts.css',
	'/css/tokens.css',
	'/css/base.css',
	'/css/layout.css',
	'/css/components.css',
	'/css/utilities.css',
	// Linked separately from main.css, after it — everything this app adds to or
	// overrides in the brand. Missing offline, the app renders as raw brand.
	'/css/app.css',
	// The faces fonts.css declares. Without them the brand type falls back
	// mid-session the first time the user opens the app without a connection.
	'/fonts/LEMONMILK-Light.otf',
	'/fonts/LEMONMILK-Medium.otf',
	'/fonts/LEMONMILK-Bold.otf',
	'/fonts/OpenSans-VariableFont_wdth,wght.ttf',
	'/fonts/Streetag-Regular.ttf',
	'/assets/index.js',
];

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(
				keys
					// Only this app's older caches. A sibling coevta app may share
					// the origin, and its cache is none of our business.
					.filter((key) => key.startsWith('coevta-tasks-') && key !== CACHE)
					.map((key) => caches.delete(key)),
			),
		),
	);
	self.clients.claim();
});

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);

	if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
		return;
	}

	// API data belongs to the offline layer, not the HTTP cache. Caching it here
	// would serve a stale task list behind the store's back, and the store would
	// have no way to know.
	if (url.pathname.startsWith('/api/')) {
		return;
	}

	event.respondWith(
		caches.match(event.request).then((cached) => {
			if (cached) {
				return cached;
			}

			return fetch(event.request).catch(() =>
				// The router uses history mode, so /tasks/new and /tasks/{id}/edit
				// have no file behind them. Serving the shell for any navigation is
				// what makes a refresh on either of those work offline.
				event.request.mode === 'navigate' ? caches.match('/index.html') : Response.error(),
			);
		}),
	);
});
