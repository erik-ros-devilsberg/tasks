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
	order: null,
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

	it('says nothing at all when the server cannot be reached', async () => {
		// Being offline is the app working as designed. The work is on the device
		// and the queue drains when a connection returns, so there is nothing the
		// user has to do and nothing worth interrupting them for.
		const remote = fakeServer();
		remote.listAll = failing(0);

		const { tasks } = store(remote);

		await tasks.syncNow();

		expect(tasks.error).toBe('');
	});

	it.each([0, 404, 500, 502, 503, 504])(
		'says nothing when the sync fails with %i — the queue waits, the user is not told',
		async (status) => {
			// Whatever a failed sync means, it is not the user's problem to solve.
			// The server may be down, the proxy may be answering for it, the phone
			// may be in a tunnel. The work is on the device and the queue retries.
			const remote = fakeServer();
			remote.listAll = failing(status);

			const { tasks } = store(remote);

			await tasks.syncNow();

			expect(tasks.error).toBe('');
		},
	);

	it('reports that it did not get through, so the caller can retry', async () => {
		const remote = fakeServer();
		remote.listAll = failing(503);

		const { tasks } = store(remote);

		await expect(tasks.syncNow()).resolves.toBe(false);
	});

	it('reports success, so the caller can stop retrying', async () => {
		const { tasks } = store(fakeServer());

		await expect(tasks.syncNow()).resolves.toBe(true);
	});

	it('leaves the saved tasks on screen when a sync fails', async () => {
		const remote = fakeServer([task('1')]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		remote.listAll = failing(0);
		await tasks.syncNow();

		expect(tasks.tasks.map((t) => t.id)).toEqual(['1']);
	});

	it('clears a rejected-change report once a later sync gets through', async () => {
		const remote = fakeServer([task('1')]);
		remote.update = failing(422);

		const { tasks } = store(remote);
		await tasks.syncNow();
		await tasks.update('1', { title: 'Renamed' });
		await tasks.syncNow();

		expect(tasks.error).toContain('could not be saved');

		await tasks.syncNow();

		expect(tasks.error).toBe('');
	});

	it('raises unauthorized on a 401 rather than reporting a connection problem', async () => {
		const remote = fakeServer();
		remote.listAll = failing(401);

		const { tasks } = store(remote);

		await tasks.syncNow();

		expect(tasks.unauthorized).toBe(true);
		expect(tasks.error).toBe('');
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

describe('deleting several at once', () => {
	it('takes every named task off the list before anything is sent', async () => {
		const remote = fakeServer([task('1'), task('2'), task('3')]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		await tasks.removeMany(['1', '3']);

		expect(tasks.tasks.map((t) => t.id)).toEqual(['2']);
		expect(remote.remove).not.toHaveBeenCalled();
		expect(tasks.pendingCount).toBe(2);
	});

	it('sends one delete per task on the next sync', async () => {
		const remote = fakeServer([task('1'), task('2'), task('3')]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		await tasks.removeMany(['1', '3']);
		await tasks.syncNow();

		expect(remote.remove).toHaveBeenCalledTimes(2);
		expect(remote.remove).toHaveBeenCalledWith('1');
		expect(remote.remove).toHaveBeenCalledWith('3');
		expect(tasks.pendingCount).toBe(0);
	});

	it('drops a never-synced task from the batch without a request', async () => {
		const remote = fakeServer([task('1')]);
		const { tasks } = store(remote);
		await tasks.syncNow();
		const created = await tasks.create({ title: 'Buy milk' });

		await tasks.removeMany(['1', created.id]);
		await tasks.syncNow();

		expect(remote.create).not.toHaveBeenCalled();
		expect(remote.remove).toHaveBeenCalledTimes(1);
		expect(remote.remove).toHaveBeenCalledWith('1');
		expect(tasks.tasks).toEqual([]);
	});

	it('lets a 404 on one of the batch reconcile without holding up the rest', async () => {
		const remote = fakeServer([task('1'), task('2')]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		remote.records.delete('1');
		const realRemove = remote.remove;
		remote.remove = vi.fn(async (id) => (id === '1' ? failing(404)() : realRemove(id)));

		await tasks.removeMany(['1', '2']);
		await tasks.syncNow();

		expect(tasks.tasks).toEqual([]);
		expect(tasks.pendingCount).toBe(0);
		expect(tasks.error).toBe('');
	});
});

describe('reordering', () => {
	const shown = (tasks) => tasks.open.map((t) => t.id);

	it('re-sorts the list on the device before anything is sent', async () => {
		const remote = fakeServer([
			task('a', { due_at: '2026-09-01', order: 0 }),
			task('b', { due_at: '2026-09-01', order: 1 }),
			task('c', { due_at: '2026-09-01', order: 2 }),
		]);
		const { tasks } = store(remote);
		await tasks.syncNow();
		remote.update = failing(0);
		remote.listAll = failing(0);

		await tasks.reorder('c', 0);

		expect(shown(tasks)).toEqual(['c', 'a', 'b']);
		expect(tasks.pendingCount).toBe(3);
	});

	it('sends one PATCH per changed task on the next sync, and none carries completed_at', async () => {
		const remote = fakeServer([
			task('a', { due_at: '2026-09-01', order: 0 }),
			task('b', { due_at: '2026-09-01', order: 1 }),
			task('c', { due_at: '2026-09-02', order: 0 }),
		]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		await tasks.reorder('c', 0);

		expect(remote.update).toHaveBeenCalledTimes(3);
		expect(remote.update).toHaveBeenCalledWith('c', { order: 0, due_at: '2026-09-01' });
		expect(remote.update).toHaveBeenCalledWith('a', { order: 1 });
		expect(remote.update).toHaveBeenCalledWith('b', { order: 2 });

		for (const [, body] of remote.update.mock.calls) {
			expect(body).not.toHaveProperty('completed_at');
		}

		expect(tasks.pendingCount).toBe(0);
	});

	it('syncs once, by itself, after the drop', async () => {
		const remote = fakeServer([
			task('a', { due_at: '2026-09-01', order: 0 }),
			task('b', { due_at: '2026-09-01', order: 1 }),
		]);
		const { tasks } = store(remote);
		await tasks.syncNow();
		remote.listAll.mockClear();

		await tasks.reorder('b', 0);

		expect(remote.listAll).toHaveBeenCalledTimes(1);
	});

	it('coalesces two offline drags of one task into a single update carrying the last order', async () => {
		const remote = fakeServer([
			task('a', { due_at: '2026-09-01', order: 0 }),
			task('b', { due_at: '2026-09-01', order: 1 }),
			task('c', { due_at: '2026-09-01', order: 2 }),
		]);
		const { tasks } = store(remote);
		await tasks.syncNow();
		const realUpdate = remote.update;
		remote.update = failing(0);
		remote.listAll = failing(0);

		await tasks.reorder('c', 0);
		await tasks.reorder('c', 2);

		expect(shown(tasks)).toEqual(['a', 'b', 'c']);
		expect(tasks.pendingCount).toBeLessThanOrEqual(3);

		remote.update = realUpdate;
		remote.listAll = vi.fn(async () => [...remote.records.values()]);
		await tasks.syncNow();

		const forC = remote.update.mock.calls.filter(([id]) => id === 'c');

		expect(forC).toHaveLength(1);
		expect(forC[0][1]).toEqual({ order: 2 });
	});

	it('shows what the server holds after a pull — a reorder made elsewhere shows up here', async () => {
		const remote = fakeServer([
			task('a', { due_at: '2026-09-01', order: 0 }),
			task('b', { due_at: '2026-09-01', order: 1 }),
		]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		remote.records.set('a', task('a', { due_at: '2026-09-01', order: 1 }));
		remote.records.set('b', task('b', { due_at: '2026-09-01', order: 0 }));
		await tasks.syncNow();

		expect(shown(tasks)).toEqual(['b', 'a']);
	});

	it('does nothing for a drop onto the same position', async () => {
		const remote = fakeServer([
			task('a', { due_at: '2026-09-01', order: 0 }),
			task('b', { due_at: '2026-09-01', order: 1 }),
		]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		await tasks.reorder('b', 1);

		expect(remote.update).not.toHaveBeenCalled();
		expect(tasks.pendingCount).toBe(0);
	});

	it('leaves completed tasks out of the index space — the drop index counts open rows only', async () => {
		const remote = fakeServer([
			task('done', { completed_at: SERVER_AT }),
			task('a', { due_at: '2026-09-01', order: 0 }),
			task('b', { due_at: '2026-09-01', order: 1 }),
		]);
		const { tasks } = store(remote);
		await tasks.syncNow();
		tasks.completedShown = true;

		await tasks.reorder('b', 0);

		expect(shown(tasks)).toEqual(['b', 'a']);
		expect(remote.update).not.toHaveBeenCalledWith('done', expect.anything());
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

describe('a server that was down and came back', () => {
	it('keeps a task created while it was down, without needing a reload', async () => {
		// The exact sequence from the field: one existing task edited and one new
		// task written while the server was down, then the server returns.
		const remote = fakeServer([task('1', { title: 'Existing' })]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		const { listAll, create, update } = remote;
		remote.listAll = failing(500);
		remote.create = failing(500);
		remote.update = failing(500);

		await tasks.create({ title: 'Written while down', notes: null, due_at: null, duration: null });
		await tasks.update('1', { title: 'Edited while down', notes: null, due_at: null, duration: null });
		await tasks.syncNow();

		expect(tasks.tasks.map((t) => t.title).sort()).toEqual(['Edited while down', 'Written while down']);

		remote.listAll = listAll;
		remote.create = create;
		remote.update = update;
		await tasks.syncNow();

		expect(tasks.tasks.map((t) => t.title).sort()).toEqual(['Edited while down', 'Written while down']);
	});

	it('survives a list answer that was in flight while the new task synced', async () => {
		// The one that actually bit: a slow list request issued before the task
		// existed, landing after it had synced. Reconciliation then read the task
		// as one the server had deleted, and dropped it.
		const remote = fakeServer([task('1', { title: 'Existing' })]);
		const { tasks } = store(remote);
		await tasks.syncNow();

		let release;
		const hang = new Promise((resolve) => {
			release = resolve;
		});
		const realListAll = remote.listAll;
		remote.listAll = vi.fn(async () => {
			remote.listAll = realListAll;
			const answer = [...remote.records.values()];
			await hang;

			return answer;
		});

		const late = tasks.syncNow();

		await tasks.create({ title: 'New one', notes: null, due_at: null, duration: null });
		await tasks.syncNow();

		release();
		await late;

		expect(tasks.tasks.map((t) => t.title).sort()).toEqual(['Existing', 'New one']);
	});
});
