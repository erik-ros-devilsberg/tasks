import { ref, watch } from 'vue';

export const COMPLETED_SHOWN_KEY = 'coevta-tasks.completed-shown';

/**
 * Whether the completed section is open, remembered across reloads.
 *
 * Every access is wrapped: localStorage throws outright in some private-browsing
 * modes, and a stored value can be anything at all once a user has poked at it.
 * A preference is never worth an exception, so both failures fall back to
 * hidden — the same state a first-time visitor gets.
 */
function read() {
	try {
		return localStorage.getItem(COMPLETED_SHOWN_KEY) === 'true';
	} catch {
		return false;
	}
}

export function useCompletedShown() {
	const shown = ref(read());

	watch(shown, (value) => {
		try {
			localStorage.setItem(COMPLETED_SHOWN_KEY, String(value));
		} catch {
			// The preference simply will not survive this reload. Not worth
			// interrupting anyone over.
		}
	});

	return shown;
}
