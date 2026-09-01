/**
 * Service worker registration, kept out of main.js so the boot path stays
 * readable and this can be skipped in tests.
 */

export function registerServiceWorker({ onUpdate } = {}) {
	if (!('serviceWorker' in navigator)) {
		return;
	}

	window.addEventListener('load', async () => {
		try {
			const registration = await navigator.serviceWorker.register('/sw.js');

			registration.addEventListener('updatefound', () => {
				const installing = registration.installing;

				installing?.addEventListener('statechange', () => {
					// A controller already present means this is an update, not a
					// first install. Tell the user rather than reloading the page
					// under their hands mid-edit.
					if (installing.state === 'installed' && navigator.serviceWorker.controller) {
						onUpdate?.();
					}
				});
			});
		} catch {
			// A failed registration costs offline support, not the app. There is
			// nothing the user can do about it, so there is nothing to say.
		}
	});
}
