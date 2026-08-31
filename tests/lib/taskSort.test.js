import { describe, it, expect } from 'vitest';

import {
	isOpen,
	isCompleted,
	isOverdue,
	dueHasTime,
	sortOpen,
	sortCompleted,
	stateOf,
	listTasks,
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

describe('the state a row is coloured by', () => {
	const now = local(2026, 8, 30, 12, 0);

	it('calls a task with a passed deadline overdue', () => {
		expect(stateOf(task('1', { due_at: '2026-08-20' }), now)).toBe('overdue');
	});

	it('calls a task due later today today, not upcoming', () => {
		expect(stateOf(task('1', { due_at: '2026-08-30T17:00:00.000000Z' }), now)).toBe('today');
	});

	it('calls a task whose time passed earlier today overdue, not today', () => {
		expect(stateOf(task('1', { due_at: '2026-08-30T09:00:00.000000Z' }), now)).toBe('overdue');
	});

	it('calls a date-only task due today today for the whole day', () => {
		expect(stateOf(task('1', { due_at: '2026-08-30' }), now)).toBe('today');
	});

	it('calls a task due after today upcoming', () => {
		expect(stateOf(task('1', { due_at: '2026-09-05' }), now)).toBe('upcoming');
	});

	it('calls a task with no due date undated', () => {
		expect(stateOf(task('1'), now)).toBe('undated');
	});

	it('calls a completed task completed, however late it was', () => {
		const done = task('1', { due_at: '2026-08-01', completed_at: '2026-08-29T10:00:00.000000Z' });

		// Completion outranks lateness: a finished task is not still a problem.
		expect(stateOf(done, now)).toBe('completed');
	});
});

describe('the one list the view renders', () => {
	it('leaves completed tasks out unless they were asked for', () => {
		const tasks = [
			task('done', { completed_at: '2026-08-29T10:00:00.000000Z' }),
			task('open'),
		];

		expect(listTasks(tasks).map((t) => t.id)).toEqual(['open']);
	});

	it('mixes completed tasks into the same list, not into a section of their own', () => {
		const tasks = [
			task('undated'),
			task('done', { due_at: '2026-09-01', completed_at: '2026-08-29T10:00:00.000000Z' }),
			task('open', { due_at: '2026-09-05' }),
		];

		// Ordered by the same rule as everything else — a completed task does not
		// sink to the bottom, it keeps its place.
		expect(listTasks(tasks, { completed: true }).map((t) => t.id)).toEqual([
			'done',
			'open',
			'undated',
		]);
	});

	it('orders soonest due first, undated last, ties broken by title', () => {
		const tasks = [
			task('b', { title: 'B' }),
			task('a', { title: 'A' }),
			task('later', { title: 'Later', due_at: '2026-09-10' }),
			task('sooner', { title: 'Sooner', due_at: '2026-09-02' }),
		];

		expect(listTasks(tasks).map((t) => t.id)).toEqual(['sooner', 'later', 'a', 'b']);
	});

	it('leaves the given array alone — sorting in place would mutate store state', () => {
		const tasks = [task('b', { title: 'B' }), task('a', { title: 'A' })];

		listTasks(tasks);

		expect(tasks.map((t) => t.id)).toEqual(['b', 'a']);
	});
});
