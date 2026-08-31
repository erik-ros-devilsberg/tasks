import { describe, it, expect } from 'vitest';

import {
	isOpen,
	isCompleted,
	isOverdue,
	dueHasTime,
	sortOpen,
	sortCompleted,
	groupOpen,
} from '@/lib/taskSort';

const task = (id, over = {}) => ({
	id,
	title: `Task ${id}`,
	notes: null,
	due_at: null,
	completed_at: null,
	...over,
});

/*
 * Every clock in this file is built with the local-time Date constructor rather
 * than an ISO string. A bare 'YYYY-MM-DD' parses as UTC midnight, which is the
 * exact bug these rules exist to avoid — writing the tests in UTC would hide it.
 */
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe('open and completed', () => {
	it('treats a null completed_at as open — there is no status field to consult', () => {
		expect(isOpen(task('1'))).toBe(true);
		expect(isCompleted(task('1'))).toBe(false);
	});

	it('treats any completed_at as completed', () => {
		const done = task('1', { completed_at: '2026-08-30T10:00:00.000000Z' });

		expect(isOpen(done)).toBe(false);
		expect(isCompleted(done)).toBe(true);
	});
});

describe('due date granularity', () => {
	it('recognises a date-only due date', () => {
		expect(dueHasTime(task('1', { due_at: '2026-09-01' }))).toBe(false);
	});

	it('recognises a datetime due date', () => {
		expect(dueHasTime(task('1', { due_at: '2026-09-01T14:30:00.000000Z' }))).toBe(true);
	});

	it('says nothing about a task with no due date', () => {
		expect(dueHasTime(task('1'))).toBe(false);
	});
});

describe('overdue', () => {
	it('is false for a task with no due date — undated work is never late', () => {
		expect(isOverdue(task('1'), local(2026, 9, 1))).toBe(false);
	});

	it('is false for a completed task, however late it was', () => {
		const done = task('1', {
			due_at: '2026-08-01',
			completed_at: '2026-08-30T10:00:00.000000Z',
		});

		expect(isOverdue(done, local(2026, 9, 1))).toBe(false);
	});

	it('holds a date-only task open until its whole day has passed, not from midnight UTC', () => {
		const dueToday = task('1', { due_at: '2026-08-30' });

		expect(isOverdue(dueToday, local(2026, 8, 30, 0, 1))).toBe(false);
		expect(isOverdue(dueToday, local(2026, 8, 30, 23, 59))).toBe(false);
	});

	it('marks a date-only task overdue once the next day starts', () => {
		const dueYesterday = task('1', { due_at: '2026-08-30' });

		expect(isOverdue(dueYesterday, local(2026, 8, 31, 0, 1))).toBe(true);
	});

	it('marks a datetime task overdue the moment its time passes, same day or not', () => {
		const at9 = task('1', { due_at: '2026-08-30T09:00:00.000000Z' });

		expect(isOverdue(at9, local(2026, 8, 30, 8, 59))).toBe(false);
		expect(isOverdue(at9, local(2026, 8, 30, 9, 1))).toBe(true);
	});

	it('compares against the registered wall clock, never a zone-shifted one', () => {
		// 09:00 is 09:00. If the offset were applied, this task would flip to
		// overdue hours early or late depending on where the browser is.
		const at9 = task('1', { due_at: '2026-08-30T09:00:00+05:00' });

		expect(isOverdue(at9, local(2026, 8, 30, 8, 59))).toBe(false);
		expect(isOverdue(at9, local(2026, 8, 30, 9, 1))).toBe(true);
	});
});

describe('ordering open tasks', () => {
	it('puts the soonest due date first', () => {
		const tasks = [
			task('c', { due_at: '2026-09-03' }),
			task('a', { due_at: '2026-09-01' }),
			task('b', { due_at: '2026-09-02' }),
		];

		expect(sortOpen(tasks).map((t) => t.id)).toEqual(['a', 'b', 'c']);
	});

	it('puts undated tasks last — a task with a date is the one with a deadline', () => {
		const tasks = [task('none'), task('dated', { due_at: '2026-09-01' })];

		expect(sortOpen(tasks).map((t) => t.id)).toEqual(['dated', 'none']);
	});

	it('breaks ties on title, ignoring case, so the order does not shuffle between loads', () => {
		const tasks = [
			task('3', { title: 'banana', due_at: '2026-09-01' }),
			task('1', { title: 'Apple', due_at: '2026-09-01' }),
			task('2', { title: 'apricot', due_at: '2026-09-01' }),
		];

		expect(sortOpen(tasks).map((t) => t.title)).toEqual(['Apple', 'apricot', 'banana']);
	});

	it('orders two undated tasks by title as well', () => {
		const tasks = [task('2', { title: 'Zebra' }), task('1', { title: 'aardvark' })];

		expect(sortOpen(tasks).map((t) => t.title)).toEqual(['aardvark', 'Zebra']);
	});

	it('leaves the given array alone — sorting in place would mutate store state', () => {
		const tasks = [task('b', { due_at: '2026-09-02' }), task('a', { due_at: '2026-09-01' })];

		sortOpen(tasks);

		expect(tasks.map((t) => t.id)).toEqual(['b', 'a']);
	});
});

describe('ordering completed tasks', () => {
	it('puts the most recently finished first — that is what a user looks for', () => {
		const tasks = [
			task('old', { completed_at: '2026-08-01T10:00:00.000000Z' }),
			task('new', { completed_at: '2026-08-30T10:00:00.000000Z' }),
		];

		expect(sortCompleted(tasks).map((t) => t.id)).toEqual(['new', 'old']);
	});
});

describe('grouping open tasks', () => {
	const now = local(2026, 8, 30, 12, 0);

	it('buckets into overdue, today, upcoming and undated in that order', () => {
		const tasks = [
			task('undated'),
			task('upcoming', { due_at: '2026-09-05' }),
			task('today', { due_at: '2026-08-30' }),
			task('overdue', { due_at: '2026-08-20' }),
		];

		const groups = groupOpen(tasks, now);

		expect(groups.map((g) => g.key)).toEqual(['overdue', 'today', 'upcoming', 'undated']);
		expect(groups.map((g) => g.tasks.map((t) => t.id))).toEqual([
			['overdue'],
			['today'],
			['upcoming'],
			['undated'],
		]);
	});

	it('omits empty groups rather than rendering an empty heading', () => {
		const groups = groupOpen([task('1', { due_at: '2026-09-05' })], now);

		expect(groups.map((g) => g.key)).toEqual(['upcoming']);
	});

	it('gives every group a label the view can render as-is', () => {
		const groups = groupOpen([task('1')], now);

		expect(groups[0].label).toBe('No due date');
	});

	it('counts a task due later today as today, not upcoming', () => {
		const laterToday = task('1', { due_at: '2026-08-30T17:00:00.000000Z' });

		expect(groupOpen([laterToday], now).map((g) => g.key)).toEqual(['today']);
	});

	it('counts a task whose time passed earlier today as overdue, not today', () => {
		const earlierToday = task('1', { due_at: '2026-08-30T09:00:00.000000Z' });

		expect(groupOpen([earlierToday], now).map((g) => g.key)).toEqual(['overdue']);
	});

	it('leaves completed tasks out entirely — this groups the open list', () => {
		const tasks = [
			task('done', { due_at: '2026-08-20', completed_at: '2026-08-21T10:00:00.000000Z' }),
			task('open', { due_at: '2026-08-20' }),
		];

		const groups = groupOpen(tasks, now);

		expect(groups.flatMap((g) => g.tasks).map((t) => t.id)).toEqual(['open']);
	});

	it('sorts within each group, so a bucket is never in arrival order', () => {
		const tasks = [
			task('later', { due_at: '2026-09-10' }),
			task('sooner', { due_at: '2026-09-02' }),
		];

		expect(groupOpen(tasks, now)[0].tasks.map((t) => t.id)).toEqual(['sooner', 'later']);
	});
});
