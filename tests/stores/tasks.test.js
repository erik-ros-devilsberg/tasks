import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

import { useTasksStore, useRemote } from '@/stores/tasks';
import { COMPLETED_SHOWN_KEY } from '@/lib/completedPreference';
import { isLocalId } from '@/lib/offlineStore';
import { ApiError } from '@/lib/api';

const task = (id, over = {}) => ({
	id,
	title: `Task ${id}`,
	notes: null,
	due_at: null,
	duration: null,
	completed_at: null,
	...over,
});

const SERVER_AT = '2026-09-01T10:00:00.000Z';

/**
 * A small in-memory server rather than a bag of stubs.
 *
 * The offline store pushes and then pulls in one sync, so a remote whose
 * `listAll` does not reflect what its own `create` just accepted would make
 * every round-trip test lie. `records` is exposed so a test can simulate
 * somebody else changing things.
 */
function fakeServer(initial = []) {
	const records = new Map(initial.map((record) => [record.id, record]));
	let issued = 0;

	const write = (record) => {
		records.set(record.id, record);

		return record;
	};

	return {
		records,
		listAll: vi.fn(async () => [...records.values()]),
		get: vi.fn(async (id) => records.get(id) ?? null),
		create: vi.fn(async (payload) => {
			issued += 1;

			return write({ ...task(`server-${issued}`), ...payload, id: `server-${issued}` });
		}),
		update: vi.fn(async (id, payload) => write({ ...records.get(id), ...payload })),
		replace: vi.fn(),
		complete: vi.fn(async (id) => write({ ...records.get(id), completed_at: SERVER_AT })),
		reopen: vi.fn(async (id) => write({ ...records.get(id), completed_at: null })),
		remove: vi.fn(async (id) => {
			records.delete(id);

			return null;
		}),
	};
}

function store(remote = fakeServer()) {
	setActivePinia(createPinia());
	useRemote(remote);

	return { tasks: useTasksStore(), remote };
}

const failing = (status) =>
	vi.fn(async () => {
		throw new ApiError(status, `Request failed (${status}).`);
	});

beforeEach(() => {
	localStorage.clear();
	setActivePinia(createPinia());
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('load', () => {
	it('reads the device rather than the network, so the list renders offline', async () => {
		const { tasks, remote } = store();

		await tasks.load();

		expect(remote.listAll).not.toHaveBeenCalled();
		expect(tasks.loaded).toBe(true);
		expect(tasks.loading).toBe(false);
	});

	it('shows what the last sync left behind', async () => {
		const { tasks } = store(fakeServer([task('1')]));

		await tasks.syncNow();
		await tasks.load();

		expect(tasks.tasks.map((t) => t.id)).toEqual(['1']);
	});

	it('starts loading, so an empty list is never flashed before the first read', () => {
		const { tasks } = store();

		expect(tasks.loading).toBe(true);
	});
});

describe('syncNow', () => {
	it('pushes local work before it pulls, or the pull would undo the push', async () => {
		const order = [];
		const remote = fakeServer();
		const { listAll, create } = remote;

		remote.listAll = vi.fn((...args) => {
			order.push('pull');

			return listAll(...args);
		});
		remote.create = vi.fn((...args) => {
			order.push('push');

			return create(...args);
		});

		const { tasks } = store(remote);
		await tasks.create({ title: 'Buy milk' });
		order.length = 0;

		await tasks.syncNow();

		expect(order).toEqual(['push', 'pull']);
	});

	it('brings down what the server holds', async () => {
		const { tasks } = store(fakeServer([task('1'), task('2')]));

		await tasks.syncNow();

		expect(tasks.tasks.map((t) => t.id).sort()).toEqual(['1', '2']);
	});

	it('says it is showing saved tasks when the server cannot be reached', async () => {
		// Not an error: the app is working exactly as intended. The user only
		// needs to know why the list might be behind.
		const remote = fakeServer();
		remote.listAll = failing(0);

		const { tasks } = store(remote);

		await tasks.syncNow();

		expect(tasks.notice).toContain('this device');
		expect(tasks.error).toBe('');
	});

	it('leaves the saved tasks on screen when a sync fails', async () => {
		const remote = fakeServer([task('1')]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		remote.listAll = failing(0);
		await tasks.syncNow();

		expect(tasks.tasks.map((t) => t.id)).toEqual(['1']);
	});

	it('clears the notice once a sync gets through', async () => {
		const remote = fakeServer();
		const { listAll } = remote;
		remote.listAll = failing(0);

		const { tasks } = store(remote);
		await tasks.syncNow();

		remote.listAll = listAll;
		await tasks.syncNow();

		expect(tasks.notice).toBe('');
	});

	it('raises unauthorized on a 401 rather than reporting a connection problem', async () => {
		const remote = fakeServer();
		remote.listAll = failing(401);

		const { tasks } = store(remote);

		await tasks.syncNow();

		expect(tasks.unauthorized).toBe(true);
		expect(tasks.notice).toBe('');
	});

	it('reports a change the server refused instead of dropping it silently', async () => {
		// A record the server already knows about, so the edit queues as an update.
		const remote = fakeServer([task('1')]);
		remote.update = failing(422);

		const { tasks } = store(remote);
		await tasks.syncNow();
		await tasks.update('1', { title: 'Renamed' });
		await tasks.syncNow();

		expect(tasks.error).toContain('could not be saved');
	});

	it('flags itself while it runs, so the view can say so', async () => {
		const { tasks } = store();

		const running = tasks.syncNow();
		expect(tasks.syncing).toBe(true);

		await running;
		expect(tasks.syncing).toBe(false);
	});
});

describe('creating', () => {
	it('shows the task at once, without waiting for the network', async () => {
		const { tasks, remote } = store();

		const created = await tasks.create({ title: 'Buy milk' });

		expect(tasks.tasks.map((t) => t.title)).toEqual(['Buy milk']);
		expect(isLocalId(created.id)).toBe(true);
		expect(remote.create).not.toHaveBeenCalled();
	});

	it('counts the task as waiting to be sent', async () => {
		const { tasks } = store();

		const created = await tasks.create({ title: 'Buy milk' });

		expect(tasks.pendingCount).toBe(1);
		expect(tasks.isPending(created.id)).toBe(true);
	});

	it('sends it on the next sync and takes the id the server issued', async () => {
		const { tasks, remote } = store();
		await tasks.create({ title: 'Buy milk' });

		await tasks.syncNow();

		expect(remote.create).toHaveBeenCalledWith({ title: 'Buy milk' });
		expect(tasks.tasks.map((t) => t.id)).toEqual(['server-1']);
		expect(tasks.pendingCount).toBe(0);
	});

	it('keeps the task when the send fails, rather than losing what was written', async () => {
		const remote = fakeServer();
		remote.create = failing(0);
		remote.listAll = failing(0);

		const { tasks } = store(remote);
		await tasks.create({ title: 'Buy milk' });

		await tasks.syncNow();

		expect(tasks.tasks.map((t) => t.title)).toEqual(['Buy milk']);
		expect(tasks.pendingCount).toBe(1);
	});
});

describe('editing', () => {
	it('saves the edit on the device straight away', async () => {
		const { tasks } = store(fakeServer([task('1')]));
		await tasks.syncNow();

		await tasks.update('1', { title: 'Renamed' });

		expect(tasks.tasks[0].title).toBe('Renamed');
	});

	it('sends eight offline edits as one request', async () => {
		const remote = fakeServer([task('1')]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		for (const title of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
			await tasks.update('1', { title });
		}

		await tasks.syncNow();

		expect(remote.update).toHaveBeenCalledTimes(1);
		expect(remote.update).toHaveBeenCalledWith('1', { title: 'H' });
	});

	it('carries a duration through an edit like any other field', async () => {
		const remote = fakeServer([task('1')]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		await tasks.update('1', { title: 'Task 1', notes: null, due_at: null, duration: 45 });

		expect(tasks.tasks[0].duration).toBe(45);

		await tasks.syncNow();

		expect(remote.update).toHaveBeenCalledWith('1', expect.objectContaining({ duration: 45 }));
	});
});

describe('completing', () => {
	it('marks the task done at once, offline', async () => {
		const { tasks } = store(fakeServer([task('1')]));
		await tasks.syncNow();

		await tasks.complete('1');

		expect(tasks.tasks[0].completed_at).not.toBeNull();
	});

	it('sends it through the completion endpoint, with no body', async () => {
		const remote = fakeServer([task('1')]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		await tasks.complete('1');
		await tasks.syncNow();

		expect(remote.complete).toHaveBeenCalledWith('1');
		expect(remote.complete).toHaveBeenCalledTimes(1);
		expect(remote.update).not.toHaveBeenCalled();
	});

	it('takes the server time over the one stamped on the device', async () => {
		// Ours is a placeholder for sorting. The server's is the record.
		const { tasks } = store(fakeServer([task('1')]));
		await tasks.syncNow();
		await tasks.complete('1');

		expect(tasks.tasks[0].completed_at).not.toBe(SERVER_AT);

		await tasks.syncNow();

		expect(tasks.tasks[0].completed_at).toBe(SERVER_AT);
	});

	it('reopens', async () => {
		const remote = fakeServer([task('1', { completed_at: '2026-09-01T10:00:00.000Z' })]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		await tasks.reopen('1');

		expect(tasks.tasks[0].completed_at).toBeNull();

		await tasks.syncNow();

		expect(remote.reopen).toHaveBeenCalledWith('1');
	});

	it('sends one call when the box is ticked and unticked offline', async () => {
		const remote = fakeServer([task('1')]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		await tasks.complete('1');
		await tasks.reopen('1');
		await tasks.syncNow();

		expect(remote.complete).not.toHaveBeenCalled();
		expect(remote.reopen).toHaveBeenCalledTimes(1);
	});

	it('does not reopen a completed task when its title is edited', async () => {
		// The trap this whole design exists around: an edit that carries
		// completed_at reopens the task the moment it coalesces with another.
		const remote = fakeServer([task('1', { completed_at: '2026-09-01T10:00:00.000Z' })]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		await tasks.update('1', { title: 'Renamed', completed_at: null });
		await tasks.syncNow();

		expect(remote.update).toHaveBeenCalledWith('1', { title: 'Renamed' });
		expect(tasks.tasks[0].completed_at).toBe('2026-09-01T10:00:00.000Z');
	});
});

describe('deleting', () => {
	it('takes the task off the list at once', async () => {
		const { tasks } = store(fakeServer([task('1')]));
		await tasks.syncNow();

		await tasks.remove('1');

		expect(tasks.tasks).toEqual([]);
	});

	it('sends nothing for a task created and deleted before it ever synced', async () => {
		const { tasks, remote } = store();
		const created = await tasks.create({ title: 'Buy milk' });

		await tasks.remove(created.id);
		await tasks.syncNow();

		expect(remote.create).not.toHaveBeenCalled();
		expect(remote.remove).not.toHaveBeenCalled();
	});

	it('treats a task the server has already lost as deleted', async () => {
		const remote = fakeServer([task('1')]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		// Somebody deleted it on another device between our sync and our delete.
		remote.records.delete('1');
		remote.remove = failing(404);

		await tasks.remove('1');
		await tasks.syncNow();

		expect(tasks.tasks).toEqual([]);
	});
});

describe('fetchOne', () => {
	it('reads a held task without a request', async () => {
		const { tasks, remote } = store(fakeServer([task('1')]));
		await tasks.syncNow();
		remote.listAll.mockClear();

		await expect(tasks.fetchOne('1')).resolves.toMatchObject({ id: '1' });
		expect(remote.listAll).not.toHaveBeenCalled();
	});

	it('syncs once for a deep link that arrived before anything was cached', async () => {
		const { tasks } = store(fakeServer([task('1')]));

		await expect(tasks.fetchOne('1')).resolves.toMatchObject({ id: '1' });
	});

	it('returns null for a task that does not exist, rather than hanging', async () => {
		const { tasks } = store();

		await expect(tasks.fetchOne('nope')).resolves.toBeNull();
	});
});

describe('forget', () => {
	it('clears the cache and the queue — this device is shared', async () => {
		const { tasks } = store();
		await tasks.create({ title: 'Buy milk' });

		await tasks.forget();

		expect(tasks.tasks).toEqual([]);
		expect(tasks.pendingCount).toBe(0);
	});

	it('leaves nothing behind for the next person to sign in and see', async () => {
		const { tasks } = store(fakeServer([task('1')]));
		await tasks.syncNow();

		await tasks.forget();
		await tasks.load();

		expect(tasks.tasks).toEqual([]);
	});
});

describe('what the list renders', () => {
	it('hides completed tasks until asked', async () => {
		const { tasks } = store(fakeServer([task('1'), task('2', { completed_at: '2026-08-30T10:00:00Z' })]));
		await tasks.syncNow();

		expect(tasks.visible.map((t) => t.id)).toEqual(['1']);
	});

	it('shows them when the preference is on', async () => {
		const { tasks } = store(fakeServer([task('1'), task('2', { completed_at: '2026-08-30T10:00:00Z' })]));
		await tasks.syncNow();

		tasks.completedShown = true;

		expect(tasks.visible.map((t) => t.id).sort()).toEqual(['1', '2']);
	});

	it('remembers the preference across a reload', async () => {
		const { tasks } = store();

		tasks.completedShown = true;
		await nextTick();

		expect(localStorage.getItem(COMPLETED_SHOWN_KEY)).toBe('true');
	});
});
