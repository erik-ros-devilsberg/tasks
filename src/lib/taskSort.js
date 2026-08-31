/**
 * Ordering and grouping. Framework-free, so the judgements below can be tested
 * without a DOM.
 *
 * The server sends `due_at` and `completed_at` and nothing else — "overdue" and
 * "today" are decisions this module makes, not fields it reads.
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
 * Soonest first, undated last, ties broken by title so the order does not
 * shuffle between loads. Returns a new array — sorting in place would mutate
 * the store's state from underneath the views.
 */
export function sortOpen(tasks) {
	return [...tasks].sort((a, b) => {
		const dueA = dueDate(a);
		const dueB = dueDate(b);

		if (dueA === null && dueB === null) {
			return byTitle(a, b);
		}

		// A task with a deadline outranks one without: the dated task is the one
		// that can actually be late.
		if (dueA === null) {
			return 1;
		}

		if (dueB === null) {
			return -1;
		}

		return dueA.getTime() - dueB.getTime() || byTitle(a, b);
	});
}

export function sortCompleted(tasks) {
	return [...tasks].sort(
		(a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime(),
	);
}

const GROUPS = [
	{ key: 'overdue', label: 'Overdue' },
	{ key: 'today', label: 'Today' },
	{ key: 'upcoming', label: 'Upcoming' },
	{ key: 'undated', label: 'No due date' },
];

function bucketOf(task, now) {
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
 * Open tasks bucketed for display. Empty groups are dropped — an empty heading
 * is noise, not information.
 */
export function groupOpen(tasks, now = new Date()) {
	const open = tasks.filter(isOpen);

	return GROUPS.map(({ key, label }) => ({
		key,
		label,
		tasks: sortOpen(open.filter((task) => bucketOf(task, now) === key)),
	})).filter((group) => group.tasks.length > 0);
}
