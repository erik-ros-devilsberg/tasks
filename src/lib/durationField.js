/**
 * Moves a task's `duration` between the API's integer number of minutes and the
 * string an input holds.
 *
 * The whole point of this module is that it never refuses. A duration is an
 * estimate the user volunteered; losing the rest of a save because the estimate
 * was typed oddly would be the "computer says no" the project rules out. Every
 * unreadable value becomes `null`, which is what the record already says when
 * nobody has estimated anything.
 */

// The first number in the string. Deliberately tolerant of what follows it, so
// "45 minutes" reads as 45 rather than as nothing.
const NUMBER = /-?\d+(?:\.\d+)?/;

/** A field value → `duration`. */
export function parseDuration(input) {
	if (input === null || input === undefined) {
		return null;
	}

	const found = NUMBER.exec(String(input));

	if (found === null) {
		return null;
	}

	const minutes = Math.round(Number(found[0]));

	// Zero and negatives both mean "no estimate here". Storing 0 instead would
	// claim the user said the task takes no time, which they did not.
	if (!Number.isFinite(minutes) || minutes <= 0) {
		return null;
	}

	return minutes;
}

/** `duration` → the field value. */
export function formatDuration(duration) {
	if (typeof duration !== 'number' || !Number.isFinite(duration)) {
		return '';
	}

	return String(duration);
}
