import { dueHasTime, parseDue } from '@/lib/taskSort';

/**
 * Renders a due date at the granularity it was given, in the time it was given.
 *
 * **Whatever time is registered is the time that is shown.** A due date is a
 * wall-clock commitment — "Friday at 14:30" — not an instant on a global
 * timeline, so nothing here converts between zones. `parseDue` reads the
 * calendar and clock fields literally; this only decides how to print them.
 *
 * The granularity matters too: "Friday" and "Friday at 14:30" are different
 * commitments, and showing a time the user never entered would invent precision
 * that is not there.
 */

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const DATE_WITH_YEAR = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
});
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

export function formatDue(task, now = new Date()) {
	const due = parseDue(task.due_at);

	if (due === null) {
		return '';
	}

	// The year earns its space only when it is not the current one.
	const date = due.getFullYear() === now.getFullYear() ? DATE.format(due) : DATE_WITH_YEAR.format(due);

	return dueHasTime(task) ? `${date}, ${TIME.format(due)}` : date;
}
