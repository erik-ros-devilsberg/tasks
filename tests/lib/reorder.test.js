import { describe, it, expect } from 'vitest';

import { reorder } from '@/lib/reorder';
import { sortOpen } from '@/lib/taskSort';

const task = (id, over = {}) => ({
	id,
	title: `Task ${id}`,
	notes: null,
	due_at: null,
	duration: null,
	order: null,
	completed_at: null,
	...over,
});

/*
 * `reorder` takes the list as the user sees it. Building the fixtures through
 * `sortOpen` keeps every test honest about that — a hand-ordered array that
 * the sort would never produce is a drop the user could never make.
 */
const shown = (...tasks) => sortOpen(tasks);

const byId = (changes) => Object.fromEntries(changes.map(({ id, ...rest }) => [id, rest]));

describe('a drop that changes nothing', () => {
	it('returns no changes when the task lands where it already was', () => {
		const list = shown(
			task('a', { due_at: '2026-09-01', order: 0 }),
			task('b', { due_at: '2026-09-01', order: 1 }),
		);

		expect(reorder(list, 'b', 1)).toEqual([]);
	});

	it('returns no changes for an unknown task rather than renumbering on a guess', () => {
		const list = shown(task('a', { due_at: '2026-09-01' }));

		expect(reorder(list, 'ghost', 0)).toEqual([]);
	});
});

describe('moving within one day', () => {
	it('renumbers the day 0..n in the new sequence and leaves due_at alone', () => {
		const list = shown(
			task('a', { due_at: '2026-09-01', order: 0 }),
			task('b', { due_at: '2026-09-01', order: 1 }),
			task('c', { due_at: '2026-09-01', order: 2 }),
		);

		const changes = byId(reorder(list, 'c', 0));

		expect(changes).toEqual({
			c: { order: 0 },
			a: { order: 1 },
			b: { order: 2 },
		});
	});

	it('numbers a day that had no order yet, so the first drag fixes the whole day', () => {
		const list = shown(
			task('a', { title: 'a', due_at: '2026-09-01' }),
			task('b', { title: 'b', due_at: '2026-09-01' }),
			task('c', { title: 'c', due_at: '2026-09-01' }),
		);

		const changes = byId(reorder(list, 'c', 1));

		expect(changes).toEqual({
			a: { order: 0 },
			c: { order: 1 },
			b: { order: 2 },
		});
	});

	it('emits only the tasks whose number changed', () => {
		const list = shown(
			task('a', { due_at: '2026-09-01', order: 0 }),
			task('b', { due_at: '2026-09-01', order: 1 }),
			task('c', { due_at: '2026-09-01', order: 2 }),
			task('d', { due_at: '2026-09-01', order: 3 }),
		);

		const changes = byId(reorder(list, 'd', 2));

		expect(changes).toEqual({
			d: { order: 2 },
			c: { order: 3 },
		});
	});

	it('keeps a timed due_at intact when the task stays in its own day', () => {
		const list = shown(
			task('a', { due_at: '2026-09-01', order: 0 }),
			task('b', { due_at: '2026-09-01T14:30:00Z', order: 1 }),
		);

		const changes = byId(reorder(list, 'b', 0));

		expect(changes.b).toEqual({ order: 0 });
	});
});

describe('moving to another day', () => {
	it('gives the task that day as a date-only due_at and renumbers the destination', () => {
		const list = shown(
			task('mon', { due_at: '2026-09-01', order: 0 }),
			task('tue-1', { due_at: '2026-09-02', order: 0 }),
			task('tue-2', { due_at: '2026-09-02', order: 1 }),
		);

		// Index 1 of the resulting list: between Tuesday's two tasks.
		const changes = byId(reorder(list, 'mon', 1));

		expect(changes).toEqual({
			mon: { order: 1, due_at: '2026-09-02' },
			'tue-2': { order: 2 },
		});
	});

	it('drops the time when the task changes day — the new day is a date, not a moment', () => {
		const list = shown(
			task('timed', { due_at: '2026-09-01T09:00:00Z' }),
			task('tue', { due_at: '2026-09-02' }),
		);

		const changes = byId(reorder(list, 'timed', 1));

		expect(changes.timed.due_at).toBe('2026-09-02');
	});

	it('does not renumber the day the task left — a gap changes nothing about its order', () => {
		const list = shown(
			task('mon-1', { due_at: '2026-09-01', order: 0 }),
			task('mon-2', { due_at: '2026-09-01', order: 1 }),
			task('mon-3', { due_at: '2026-09-01', order: 2 }),
			task('tue', { due_at: '2026-09-02', order: 0 }),
		);

		const changes = byId(reorder(list, 'mon-2', 3));

		expect(changes['mon-1']).toBeUndefined();
		expect(changes['mon-3']).toBeUndefined();
		expect(changes['mon-2']).toEqual({ order: 1, due_at: '2026-09-02' });
	});

	it('stays in its own day when dropped on the boundary with the next one', () => {
		const list = shown(
			task('mon-1', { due_at: '2026-09-01', order: 0 }),
			task('mon-2', { due_at: '2026-09-01', order: 1 }),
			task('tue', { due_at: '2026-09-02', order: 0 }),
		);

		// Last of Monday and first of Tuesday are the same slot. Own day wins:
		// a drag that merely reaches the edge must not silently change a date.
		const changes = byId(reorder(list, 'mon-1', 1));

		expect(changes).toEqual({
			'mon-2': { order: 0 },
			'mon-1': { order: 1 },
		});
	});

	it('joins the earlier day when dropped on a boundary between two other days', () => {
		const list = shown(
			task('mon', { due_at: '2026-09-01', order: 0 }),
			task('tue', { due_at: '2026-09-02', order: 0 }),
			task('wed', { due_at: '2026-09-03', order: 0 }),
		);

		// Wednesday's task dragged up to sit between Monday and Tuesday: neither
		// is its own day, so it joins the one above — "after Monday's tasks" is
		// how the slot reads on screen.
		const changes = byId(reorder(list, 'wed', 1));

		expect(changes.wed).toEqual({ order: 1, due_at: '2026-09-01' });
	});
});

describe('the undated tail', () => {
	it('strips due_at from a dated task dropped into the tail and renumbers it', () => {
		const list = shown(
			task('dated', { due_at: '2026-09-01', order: 0 }),
			task('none-1', { title: 'a', order: 0 }),
			task('none-2', { title: 'b', order: 1 }),
		);

		const changes = byId(reorder(list, 'dated', 1));

		expect(changes).toEqual({
			dated: { order: 1, due_at: null },
			'none-2': { order: 2 },
		});
	});

	it('gives an undated task the day it is dropped into', () => {
		const list = shown(
			task('mon-1', { due_at: '2026-09-01', order: 0 }),
			task('mon-2', { due_at: '2026-09-01', order: 1 }),
			task('none'),
		);

		const changes = byId(reorder(list, 'none', 0));

		expect(changes).toEqual({
			none: { order: 0, due_at: '2026-09-01' },
			'mon-1': { order: 1 },
			'mon-2': { order: 2 },
		});
	});

	it('moves within the tail without touching due_at', () => {
		const list = shown(task('x', { title: 'a', order: 0 }), task('y', { title: 'b', order: 1 }));

		const changes = byId(reorder(list, 'y', 0));

		expect(changes).toEqual({
			y: { order: 0 },
			x: { order: 1 },
		});
	});
});

describe('what a change may carry', () => {
	it('never carries completed_at — completion has its own operations', () => {
		const list = shown(
			task('a', { due_at: '2026-09-01' }),
			task('b', { due_at: '2026-09-02' }),
		);

		for (const change of reorder(list, 'b', 0)) {
			expect(change).not.toHaveProperty('completed_at');
		}
	});

	it('carries due_at only on the task that changed day', () => {
		const list = shown(
			task('a', { due_at: '2026-09-01', order: 0 }),
			task('b', { due_at: '2026-09-02', order: 0 }),
		);

		const changes = byId(reorder(list, 'b', 0));

		expect(changes.b).toHaveProperty('due_at', '2026-09-01');
		expect(changes.a).not.toHaveProperty('due_at');
	});

	it('clamps an index past the end to the end rather than throwing', () => {
		const list = shown(task('a', { due_at: '2026-09-01' }), task('b', { due_at: '2026-09-01' }));

		const changes = byId(reorder(list, 'a', 99));

		expect(changes).toEqual({
			b: { order: 0 },
			a: { order: 1 },
		});
	});

	it('leaves the given array alone', () => {
		const list = shown(task('a', { due_at: '2026-09-01' }), task('b', { due_at: '2026-09-01' }));
		const before = list.map((t) => ({ ...t }));

		reorder(list, 'b', 0);

		expect(list).toEqual(before);
	});
});
