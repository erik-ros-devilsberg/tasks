/**
 * Ordering and grouping. Framework-free, so the judgements below can be tested
 * without a DOM.
 *
 * The server sends `due_at`, `completed_at` and an optional `order` — "overdue"
 * and "today" are decisions this module makes, not fields it reads. `order` is
 * the one thing it reads as given: a position the user chose by dragging.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const PARTS = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;

export function isCompleted(task) {
	return task.completed_at !== null && task.completed_at !== undefined;
}

export function isOpen(task) {
	return !isCompleted(task);
}

export function dueHasTime(task) {
	return typeof task.due_at === 'string' && !DATE_ONLY.test(task.due_at);
}

/**
 * A due date as a local Date, read literally.
 *
 * A due date is a **wall-clock commitment, not an instant**: whatever time was
 * registered is the time that is shown. So the calendar and clock fields are
 * taken straight off the string and rebuilt in local time, and any offset the
 * server appends is ignored rather than applied.
 *
 * Handing the string to `new Date()` instead would convert it — `'2026-08-30'`
 * would land on UTC midnight (the evening of the 29th in the Americas) and a
 * task registered for 14:30 would display as some other hour entirely.
 */
export function parseDue(due_at) {
	if (!due_at) {
		return null;
	}

	const parts = PARTS.exec(due_at);

	if (parts === null) {
		return null;
	}

	const [, year, month, day, hour = 0, minute = 0] = parts;

	return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}

function dueDate(task) {
	return parseDue(task.due_at);
}

/**
 * The instant a task stops being on time.
 *
 * A date-only task has all day: it is late once the *next* day begins. A task
 * with a time is late the moment that time passes.
 */
function dueDeadline(task) {
	const due = dueDate(task);

	if (due === null) {
		return null;
	}

	if (dueHasTime(task)) {
		return due;
	}

	return new Date(due.getFullYear(), due.getMonth(), due.getDate() + 1);
}

export function isOverdue(task, now = new Date()) {
	if (isCompleted(task)) {
		return false;
	}

	const deadline = dueDeadline(task);

	return deadline !== null && deadline.getTime() <= now.getTime();
}

const sameDay = (a, b) =>
	a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const byTitle = (a, b) => (a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base' });

/**
 * The calendar day a task belongs to, as the `YYYY-MM-DD` it was registered
 * with, or null when undated. A timed task and a date-only task on the same
 * date share a day: ordering happens within days, and a time of day is a
 * detail inside one, not a day of its own.
 */
export function dayOf(task) {
	const parts = typeof task?.due_at === 'string' ? PARTS.exec(task.due_at) : null;

	return parts === null ? null : `${parts[1]}-${parts[2]}-${parts[3]}`;
}

/**
 * The explicit position, or null. Anything that is not a whole number >= 0 is
 * treated as no position rather than refused — the server validates what it
 * stores, and a client that threw on a stray value would lose the whole list
 * to one bad record.
 */
export function orderOf(task) {
	const order = task?.order;

	return Number.isInteger(order) && order >= 0 ? order : null;
}

/*
 * Within one day. Explicit positions first, ascending; then the tasks nobody
 * has placed, by time of day and then title. A dragged task beating a timed
 * one is the point: the drag is the user saying which comes first.
 */
function withinDay(a, b) {
	const orderA = orderOf(a);
	const orderB = orderOf(b);

	if (orderA !== null && orderB !== null) {
		return orderA - orderB || byTitle(a, b);
	}

	if (orderA !== null) {
		return -1;
	}

	if (orderB !== null) {
		return 1;
	}

	const dueA = dueDate(a);
	const dueB = dueDate(b);
	const timeA = dueA === null ? 0 : dueA.getTime();
	const timeB = dueB === null ? 0 : dueB.getTime();

	return timeA - timeB || byTitle(a, b);
}

/**
 * Soonest day first, undated last, and within a day the user's own order
 * before anything else. Returns a new array — sorting in place would mutate
 * the store's state from underneath the views.
 *
 * Days compare as the strings they were registered with. `YYYY-MM-DD` sorts
 * lexically in date order, and it keeps the comparison off `Date`, which is
 * how a due date gets shifted a day by a time zone.
 */
export function sortOpen(tasks) {
	return [...tasks].sort((a, b) => {
		const dayA = dayOf(a);
		const dayB = dayOf(b);

		if (dayA === dayB) {
			return withinDay(a, b);
		}

		// A task with a deadline outranks one without: the dated task is the one
		// that can actually be late.
		if (dayA === null) {
			return 1;
		}

		if (dayB === null) {
			return -1;
		}

		return dayA < dayB ? -1 : 1;
	});
}

export function sortCompleted(tasks) {
	return [...tasks].sort(
		(a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime(),
	);
}

/**
 * The one word that describes a task right now: `completed`, `overdue`,
 * `today`, `upcoming` or `undated`.
 *
 * The list signals this with a background colour, so it is also what the
 * screen-reader-only label on each row says — colour is never the only carrier.
 */
export function stateOf(task, now = new Date()) {
	// Completion outranks lateness. A finished task is not still a problem, no
	// matter how long it sat there.
	if (isCompleted(task)) {
		return 'completed';
	}

	if (isOverdue(task, now)) {
		return 'overdue';
	}

	const due = dueDate(task);

	if (due === null) {
		return 'undated';
	}

	return sameDay(due, now) ? 'today' : 'upcoming';
}

/**
 * Everything the list renders, in one flat sequence.
 *
 * Completed tasks are mixed in by the same ordering rule rather than pushed to
 * the end: the user asked for one list, and a finished task keeps the place its
 * due date earned it.
 */
export function listTasks(tasks, { completed = false } = {}) {
	return sortOpen(tasks.filter((task) => completed || isOpen(task)));
}
