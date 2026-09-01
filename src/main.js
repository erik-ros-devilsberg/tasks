import { createApp } from 'vue';
import { createPinia } from 'pinia';

import App from '@/App.vue';
import router from '@/router';
import { registerServiceWorker } from '@/lib/registerSw';
import { createTasksOfflineStore, useOfflineStore } from '@/stores/tasks';

const app = createApp(App);

app.use(createPinia()).use(router);

// The real IndexedDB-backed store is installed once, here, on the session's api
// instance so a 401 anywhere clears the session. Tests inject a fake through the
// same seam and never touch IndexedDB.
useOfflineStore(createTasksOfflineStore());

app.mount('#app');

/*
 * Development only ever runs from the dev server, where /assets/index.js does
 * not exist — the worker's precache is atomic, so it would fail to install and
 * leave a half-registered worker behind. Offline behaviour is exercised against
 * a real build: `npm run build && npm run preview`.
 */
if (import.meta.env.PROD) {
	registerServiceWorker({
		onUpdate: () => {
			window.dispatchEvent(new CustomEvent('app-update-ready'));
		},
	});
}
