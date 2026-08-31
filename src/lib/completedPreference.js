/**
 * Whether completed tasks are shown in the list, remembered across reloads.
 *
 * Framework-free on purpose: the store owns the reactive ref, this owns the
 * storage. Every access is wrapped — localStorage throws outright in some
 * private-browsing modes, and a stored value can be anything at all once a user
 * has poked at it. A preference is never worth an exception, so both failures
 * fall back to hidden: the same state a first-time visitor gets.
 */

export const COMPLETED_SHOWN_KEY = 'coevta-tasks.completed-shown';

export function readCompletedShown() {
	try {
		return localStorage.getItem(COMPLETED_SHOWN_KEY) === 'true';
	} catch {
		return false;
	}
}

export function writeCompletedShown(value) {
	try {
		localStorage.setItem(COMPLETED_SHOWN_KEY, String(value));
	} catch {
		// The preference simply will not survive this reload. Not worth
		// interrupting anyone over.
	}
}
