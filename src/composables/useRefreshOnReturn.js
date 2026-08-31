import { onMounted, onUnmounted } from 'vue';

/*
 * A tab switch fires visibilitychange and focus one after the other. Anything
 * arriving inside this window is the tail of the same return, not a second one.
 */
const QUIET_MS = 500;

/**
 * Reloads when the user comes back to the tab — and only then.
 *
 * Deliberately not a poll. Nothing changes underneath a user working alone in
 * their own list, so a timer would be load spent to discover that nothing
 * happened. Coming back from another tab or another app is the one moment the
 * list could genuinely be stale.
 */
export function useRefreshOnReturn(refresh) {
	let last = 0;

	function trigger() {
		// visibilitychange fires on the way out as well as the way back.
		if (document.visibilityState === 'hidden') {
			return;
		}

		const now = Date.now();

		if (now - last < QUIET_MS) {
			return;
		}

		last = now;
		refresh();
	}

	onMounted(() => {
		document.addEventListener('visibilitychange', trigger);
		window.addEventListener('focus', trigger);
	});

	onUnmounted(() => {
		document.removeEventListener('visibilitychange', trigger);
		window.removeEventListener('focus', trigger);
	});
}
