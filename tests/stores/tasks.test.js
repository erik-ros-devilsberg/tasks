import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useTasksStore, useRemote } from '@/stores/tasks';

const task = (id, over = {}) => ({
	id,
	title: `Task ${id}`,
	notes: null,
	due_at: null,
	completed_at: null,
	...over,
});

function fakeRemote(over = {}) {
	return {
		listAll: vi.fn().mockResolvedValue([]),
		get: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		replace: vi.fn(),
		complete: vi.fn(),
		reopen: vi.fn(),
		remove: vi.fn().mockResolvedValue(null),
		...over,
	};
}

function store(remote = fakeRemote()) {
	setActivePinia(createPinia());
	useRemote(remote);

	return { tasks: useTasksStore(), remote };
}

const failure = (status) => Object.assign(new Error(`Request failed (${status}).`), { status });

beforeEach(() => {
	setActivePinia(createPinia());
});

describe('load', () => {
	it('fills the store from the server', async () => {
		const { tasks } = store(fakeRemote({ listAll: vi.fn().mockResolvedValue([task('1')]) }));

		await tasks.load();

		expect(tasks.tasks.map((t) => t.id)).toEqual(['1']);
	});

	it('clears loading when the request succeeds', async () => {
		const { tasks } = store();

		const pending = tasks.load();
		expect(tasks.loading).toBe(true);

		await pending;
		expect(tasks.loading).toBe(false);
	});

	it('clears loading when the request fails, so no spinner outlives the failure', async () => {
		const { tasks } = store(fakeRemote({ listAll: vi.fn().mockRejectedValue(failure(500)) }));

		await tasks.load();

		expect(tasks.loading).toBe(false);
		expect(tasks.error).toBeTruthy();
	});

	it('keeps the tasks it already had when a later load fails — blanking the list helps nobody', async () => {
		const listAll = vi
			.fn()
			.mockResolvedValueOnce([task('1')])
			.mockRejectedValueOnce(failure(500));
		const { tasks } = store(fakeRemote({ listAll }));

		await tasks.load();
		await tasks.load();

		expect(tasks.tasks.map((t) => t.id)).toEqual(['1']);
		expect(tasks.error).toBeTruthy();
	});

	it('drops a stale error once a later load succeeds', async () => {
		const listAll = vi
			.fn()
			.mockRejectedValueOnce(failure(500))
			.mockResolvedValueOnce([task('1')]);
		const { tasks } = store(fakeRemote({ listAll }));

		await tasks.load();
		await tasks.load();

		expect(tasks.error).toBe('');
	});

	it('does not swallow a 401 — the session layer has to see it to sign the user out', async () => {
		const { tasks } = store(fakeRemote({ listAll: vi.fn().mockRejectedValue(failure(401)) }));

		await expect(tasks.load()).rejects.toMatchObject({ status: 401 });
	});
});

describe('derived views of the list', () => {
	it('exposes the open tasks grouped and ordered, not raw', async () => {
		const listAll = vi.fn().mockResolvedValue([
			task('undated'),
			task('done', { completed_at: '2026-08-30T10:00:00.000000Z' }),
			task('soon', { due_at: '2099-01-01' }),
		]);
		const { tasks } = store(fakeRemote({ listAll }));

		await tasks.load();

		expect(tasks.groups.map((g) => g.key)).toEqual(['upcoming', 'undated']);
	});

	it('exposes completed tasks separately, most recent first', async () => {
		const listAll = vi.fn().mockResolvedValue([
			task('old', { completed_at: '2026-08-01T10:00:00.000000Z' }),
			task('new', { completed_at: '2026-08-30T10:00:00.000000Z' }),
			task('open'),
		]);
		const { tasks } = store(fakeRemote({ listAll }));

		await tasks.load();

		expect(tasks.completed.map((t) => t.id)).toEqual(['new', 'old']);
	});
});

describe('create', () => {
	it('adds the record the server returned rather than a locally guessed one', async () => {
		const created = task('server-id', { title: 'Untitled task' });
		const { tasks, remote } = store(fakeRemote({ create: vi.fn().mockResolvedValue(created) }));

		await tasks.create({ title: '' });

		expect(remote.create).toHaveBeenCalledWith({ title: '' });
		expect(tasks.tasks).toContainEqual(created);
	});
});

describe('update', () => {
	it('replaces the record in place with the server response', async () => {
		const listAll = vi.fn().mockResolvedValue([task('1', { title: 'Old' })]);
		const update = vi.fn().mockResolvedValue(task('1', { title: 'New' }));
		const { tasks } = store(fakeRemote({ listAll, update }));

		await tasks.load();
		await tasks.update('1', { title: 'New' });

		expect(tasks.tasks.map((t) => t.title)).toEqual(['New']);
	});
});

describe('complete and reopen', () => {
	it('takes the server record, so completed_at is the server clock not ours', async () => {
		const listAll = vi.fn().mockResolvedValue([task('1')]);
		const done = task('1', { completed_at: '2026-08-30T10:00:00.000000Z' });
		const { tasks, remote } = store(
			fakeRemote({ listAll, complete: vi.fn().mockResolvedValue(done) }),
		);

		await tasks.load();
		await tasks.complete('1');

		expect(remote.complete).toHaveBeenCalledWith('1');
		expect(tasks.tasks[0].completed_at).toBe('2026-08-30T10:00:00.000000Z');
	});

	it('rolls the row back when completing fails, rather than showing a tick that did not save', async () => {
		const listAll = vi.fn().mockResolvedValue([task('1')]);
		const { tasks } = store(
			fakeRemote({ listAll, complete: vi.fn().mockRejectedValue(failure(500)) }),
		);

		await tasks.load();
		await tasks.complete('1');

		expect(tasks.tasks[0].completed_at).toBeNull();
		expect(tasks.error).toBeTruthy();
	});

	it('reopens through the remote and takes back the cleared record', async () => {
		const listAll = vi
			.fn()
			.mockResolvedValue([task('1', { completed_at: '2026-08-30T10:00:00.000000Z' })]);
		const { tasks, remote } = store(
			fakeRemote({ listAll, reopen: vi.fn().mockResolvedValue(task('1')) }),
		);

		await tasks.load();
		await tasks.reopen('1');

		expect(remote.reopen).toHaveBeenCalledWith('1');
		expect(tasks.tasks[0].completed_at).toBeNull();
	});
});

describe('forget', () => {
	it('empties the store, so the next account never sees the last one’s tasks', async () => {
		const listAll = vi.fn().mockResolvedValue([task('1')]);
		const { tasks } = store(fakeRemote({ listAll }));

		await tasks.load();
		tasks.forget();

		expect(tasks.tasks).toEqual([]);
		expect(tasks.loaded).toBe(false);
		expect(tasks.error).toBe('');
	});

	it('leaves the store loading, so no empty state flashes before the next load', async () => {
		const { tasks } = store();

		await tasks.load();
		tasks.forget();

		expect(tasks.loading).toBe(true);
	});

	it('discards a load that was already in flight when it was called', async () => {
		let settle;
		const listAll = vi.fn().mockReturnValue(new Promise((resolve) => (settle = resolve)));
		const { tasks } = store(fakeRemote({ listAll }));

		const pending = tasks.load();
		tasks.forget();
		settle([task('stale')]);
		await pending;

		expect(tasks.tasks).toEqual([]);
	});
});

describe('overlapping loads', () => {
	it('ignores a response overtaken by a newer load, rather than last-one-wins', async () => {
		let settleFirst;
		const listAll = vi
			.fn()
			.mockReturnValueOnce(new Promise((resolve) => (settleFirst = resolve)))
			.mockResolvedValueOnce([task('second')]);
		const { tasks } = store(fakeRemote({ listAll }));

		const first = tasks.load();
		await tasks.load();
		settleFirst([task('first')]);
		await first;

		expect(tasks.tasks.map((t) => t.id)).toEqual(['second']);
	});

	it('keeps loading true while a newer load is still running', async () => {
		let settleSecond;
		const listAll = vi
			.fn()
			.mockResolvedValueOnce([task('first')])
			.mockReturnValueOnce(new Promise((resolve) => (settleSecond = resolve)));
		const { tasks } = store(fakeRemote({ listAll }));

		const first = tasks.load();
		const second = tasks.load();
		await first;

		expect(tasks.loading).toBe(true);

		settleSecond([task('second')]);
		await second;
	});
});

describe('a first load that fails', () => {
	it('does not claim to be showing tasks it never loaded', async () => {
		const { tasks } = store(fakeRemote({ listAll: vi.fn().mockRejectedValue(failure(500)) }));

		await tasks.load();

		expect(tasks.loaded).toBe(false);
		expect(tasks.error).not.toMatch(/last loaded/i);
	});
});

describe('an action the server answers without a body', () => {
	it('reloads rather than guessing, so the row cannot silently do nothing', async () => {
		const listAll = vi
			.fn()
			.mockResolvedValueOnce([task('1')])
			.mockResolvedValueOnce([task('1', { completed_at: '2026-08-30T10:00:00.000000Z' })]);
		const { tasks } = store(
			fakeRemote({ listAll, complete: vi.fn().mockResolvedValue(null) }),
		);

		await tasks.load();
		await tasks.complete('1');

		expect(listAll).toHaveBeenCalledTimes(2);
		expect(tasks.tasks[0].completed_at).toBe('2026-08-30T10:00:00.000000Z');
	});
});

describe('remove', () => {
	it('drops the task from the list', async () => {
		const listAll = vi.fn().mockResolvedValue([task('1'), task('2')]);
		const { tasks } = store(fakeRemote({ listAll }));

		await tasks.load();
		await tasks.remove('1');

		expect(tasks.tasks.map((t) => t.id)).toEqual(['2']);
	});

	it('keeps the task when the delete fails, so the list still matches the server', async () => {
		const listAll = vi.fn().mockResolvedValue([task('1')]);
		const { tasks } = store(
			fakeRemote({ listAll, remove: vi.fn().mockRejectedValue(failure(500)) }),
		);

		await tasks.load();
		await tasks.remove('1');

		expect(tasks.tasks.map((t) => t.id)).toEqual(['1']);
		expect(tasks.error).toBeTruthy();
	});
});
