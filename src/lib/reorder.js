/**
 * What a drop means. Framework-free, pure: given the open list as the user
 * sees it and where the dragged task should now sit, returns the changes that
 * make it so. Nothing here touches storage or the network — the store applies
 * the changes, the drag sprint only has to ask.
 *
 * A "day" is the calendar day (`dayOf`), the undated tail counts as one more.
 * The task takes the day it lands in, and that day is renumbered `0..n` in the
 * sequence shown. The day it left is not renumbered: a gap in the numbers says
 * nothing about relative order, and touching it would be more PATCHes for no
 * visible change.
 */

import { dayOf, orderOf } from '@/lib/taskSort';

/**
 * The day a task dropped at `index` in `list` joins.
 *
 * The slot between two days is ambiguous — last of the one above or first of
 * the one below. Own day wins when it is either, so a drag that merely reaches
 * the edge of its day cannot silently change a date. Otherwise the day above:
 * on screen the slot reads as "after those tasks". At the very top there is
 * nothing above, so it is the day below.
 */
function destinationDay(list, index, own) {
	const above = index > 0 ? dayOf(list[index - 1]) : undefined;
	const below = index < list.length - 1 ? dayOf(list[index + 1]) : undefined;

	if (above === own || below === own) {
		return own;
	}

	if (above !== undefined) {
		return above;
	}

	if (below !== undefined) {
		return below;
	}

	// A list of one: nowhere to go.
	return own;
}

/**
 * @param {object[]} shown  open tasks in displayed order (see `sortOpen`)
 * @param {string} draggedId
 * @param {number} targetIndex  the index the task should occupy afterwards
 * @returns {{ id: string, order: number, due_at?: string|null }[]}
 */
export function reorder(shown, draggedId, targetIndex) {
	const dragged = shown.find((task) => task.id === draggedId);

	if (!dragged) {
		return [];
	}

	const rest = shown.filter((task) => task.id !== draggedId);
	const index = Math.max(0, Math.min(targetIndex, rest.length));
	const result = [...rest.slice(0, index), dragged, ...rest.slice(index)];

	// Same sequence as before is a drop onto its own slot. Renumbering a day
	// nobody reordered would send PATCHes for nothing.
	if (result.every((task, i) => task.id === shown[i].id)) {
		return [];
	}

	const own = dayOf(dragged);
	const day = destinationDay(result, index, own);

	// Date-only when the day changes: the new day is a date, not a moment, and
	// carrying a time across would invent one the user never set.
	const placed = day === own ? dragged : { ...dragged, due_at: day };

	const changes = [];
	let position = 0;

	for (const task of result) {
		const record = task.id === draggedId ? placed : task;

		if (dayOf(record) !== day) {
			continue;
		}

		const order = position;
		position += 1;

		const moved = record === placed && day !== own;

		if (orderOf(record) !== order || moved) {
			changes.push(moved ? { id: record.id, order, due_at: day } : { id: record.id, order });
		}
	}

	return changes;
}
