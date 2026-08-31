/**
 * Moves a due date between the API's single `due_at` string and the form's two
 * inputs — a date and an optional time.
 *
 * Two inputs rather than one `datetime-local`, because the granularity is the
 * user's choice to make: `datetime-local` cannot express "this day, no
 * particular time", and its value is local wall-clock anyway.
 *
 * Nothing here converts between time zones. Whatever time is registered is the
 * time that is stored and shown — see CLAUDE.md §7.
 */

const PARTS = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/;

/** `due_at` → the two field values. */
export function splitDue(due_at) {
	const parts = typeof due_at === 'string' ? PARTS.exec(due_at) : null;

	if (parts === null) {
		return { date: '', time: '' };
	}

	return { date: parts[1], time: parts[2] ?? '' };
}

/**
 * The two field values → `due_at`.
 *
 * A time with no date is dropped rather than rejected: it is not a due date,
 * and refusing the whole save over it would be exactly the "computer says no"
 * this app avoids.
 */
export function joinDue(date, time) {
	if (!date) {
		return null;
	}

	if (!time) {
		return date;
	}

	// The Z is what the server expects. It is not a conversion — the wall-clock
	// fields are sent exactly as they were typed.
	return `${date}T${time}:00Z`;
}
