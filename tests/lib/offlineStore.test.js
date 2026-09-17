import { describe, it, expect, vi, beforeEach } from 'vitest';

import { memoryKv } from '@/lib/kv';
import { createOfflineStore, isLocalId } from '@/lib/offlineStore';
import { ApiError } from '@/lib/api';

let kv;
let outboxKv;
let remote;

const AT = '2026-09-01T10:00:00.000Z';

const task = (id, over = {}) => ({
	id,
	title: `Task ${id}`,
	notes: null,
	due_at: null,
	duration: null,
	completed_at: null,
	...over,
});

function fakeRemote(list = []) {
	return {
		listAll: vi.fn(async () => list),
		get: vi.fn(async (id) => list.find((record) => record.id === id) ?? null),
		create: vi.fn(async (payload) => ({ ...task('server-1'), ...payload, id: 'server-1' })),
		update: vi.fn(async (id, payload) => ({ ...task(id), ...payload })),
		complete: vi.fn(async (id) => ({ ...task(id), completed_at: AT })),
		reopen: vi.fn(async (id) => task(id)),
		remove: vi.fn(async () => null),
	};
}

const store = (over = {}) =>
	createOfflineStore({ kv, outboxKv, remote, now: () => AT, ...over });

const queued = async () => {
	const { createOutbox } = await import('@/lib/outbox');

	return (await createOutbox({ kv: outboxKv }).pending()).map((entry) => entry.type);
};

beforeEach(() => {
	kv = memoryKv();
	outboxKv = memoryKv();
	remote = fakeRemote();
});

describe('reading', () => {
	it('reads from the device, not from the network — that is what makes it work offline', async () => {
		await kv.set('1', task('1'));

		const offline = store();

		await expect(offline.cached()).resolves.toEqual([task('1')]);
		expect(remote.listAll).not.toHaveBeenCalled();
	});

	it('applies the ordering it was given, so the caller decides what "first" means', async () => {
		await kv.set('1', task('1', { title: 'B' }));
		await kv.set('2', task('2', { title: 'A' }));

		const sorted = await store({ sort: (a, b) => a.title.localeCompare(b.title) }).cached();

		expect(sorted.map((record) => record.title)).toEqual(['A', 'B']);
	});

	it('reads one record without a request', async () => {
		await kv.set('1', task('1'));

		await expect(store().get('1')).resolves.toEqual(task('1'));
	});
});

describe('creating offline', () => {
	it('gives the record an id the app can recognise as not yet real', async () => {
		const created = await store().create({ title: 'Buy milk' });

		expect(isLocalId(created.id)).toBe(true);
	});

	it('shows the task immediately, before anything has been sent', async () => {
		const offline = store();
		const created = await offline.create({ title: 'Buy milk' });

		const cached = await offline.cached();

		expect(cached).toHaveLength(1);
		expect(cached[0].title).toBe('Buy milk');
		expect(created.completed_at).toBeNull();
		expect(remote.create).not.toHaveBeenCalled();
	});

	it('queues the create so it survives a reload', async () => {
		await store().create({ title: 'Buy milk' });

		expect(await queued()).toEqual(['create']);
	});
});

describe('editing offline', () => {
	it('merges the edit onto the stored record rather than replacing it', async () => {
		// The payload is a PATCH body. Writing it over the record whole would wipe
		// every field the form did not send.
		await kv.set('1', task('1', { notes: 'context', duration: 45 }));

		const offline = store();
		await offline.update('1', { title: 'Renamed' });

		await expect(offline.get('1')).resolves.toMatchObject({
			title: 'Renamed',
			notes: 'context',
			duration: 45,
		});
	});

	it('keeps the completion state out of the edit, so a saved edit cannot reopen a task', async () => {
		await kv.set('1', task('1', { completed_at: AT }));

		await store().update('1', { title: 'Renamed', completed_at: null });

		const { createOutbox } = await import('@/lib/outbox');
		const entry = (await createOutbox({ kv: outboxKv }).pending())[0];

		expect(entry.payload).not.toHaveProperty('completed_at');
	});

	it('leaves the stored completion alone when an edit is saved', async () => {
		await kv.set('1', task('1', { completed_at: AT }));

		const offline = store();
		await offline.update('1', { title: 'Renamed', completed_at: null });

		await expect(offline.get('1')).resolves.toMatchObject({ completed_at: AT });
	});
});

describe('completing offline', () => {
	it('stamps the moment the box was ticked, not the moment a connection returned', async () => {
		// The server stamps its own time on sync and that one wins. This is a
		// placeholder so the list sorts sensibly in the meantime.
		await kv.set('1', task('1'));

		const offline = store();
		await offline.complete('1');

		await expect(offline.get('1')).resolves.toMatchObject({ completed_at: AT });
		expect(await queued()).toEqual(['complete']);
	});

	it('reopens by clearing the stamp', async () => {
		await kv.set('1', task('1', { completed_at: AT }));

		const offline = store();
		await offline.reopen('1');

		await expect(offline.get('1')).resolves.toMatchObject({ completed_at: null });
		expect(await queued()).toEqual(['reopen']);
	});

	it('does nothing for a record it does not hold, rather than inventing one', async () => {
		await expect(store().complete('missing')).resolves.toBeNull();
		expect(await queued()).toEqual([]);
	});
});

describe('deleting offline', () => {
	it('takes the task off the list at once', async () => {
		await kv.set('1', task('1'));

		const offline = store();
		await offline.remove('1');

		await expect(offline.cached()).resolves.toEqual([]);
	});

	it('sends nothing at all for a task created and deleted before it ever synced', async () => {
		const offline = store();
		const created = await offline.create({ title: 'Buy milk' });
		await offline.remove(created.id);

		expect(await queued()).toEqual([]);

		await offline.flush();

		expect(remote.create).not.toHaveBeenCalled();
		expect(remote.remove).not.toHaveBeenCalled();
	});
});

describe('pending work', () => {
	it('reports which records have work waiting, so the list can mark them', async () => {
		const offline = store();
		await offline.create({ title: 'Buy milk' });

		const ids = await offline.pendingIds();

		expect(ids).toHaveLength(1);
		expect(isLocalId(ids[0])).toBe(true);
		await expect(offline.pendingCount()).resolves.toBe(1);
	});
});

describe('flushing', () => {
	/*
	 * The swap must store the server's record before it deletes the temporary
	 * one. The other order has a window with neither on the device, and if the
	 * store fails inside it — a record the adapter cannot key, a quota error —
	 * the task is simply gone until the next pull happens to bring it back.
	 */
	it('keeps the task on the device when storing the server record fails', async () => {
		const offline = store();
		const created = await offline.create({ title: 'Buy milk' });

		remote.create = vi.fn(async () => ({ data: { id: 'server-1', title: 'Buy milk' } }));

		await expect(offline.flush()).rejects.toThrow();

		const cached = await offline.cached();

		expect(cached).toHaveLength(1);
		expect(cached[0].id).toBe(created.id);
	});

	it('swaps the temporary record for the one the server issued', async () => {
		const offline = store();
		await offline.create({ title: 'Buy milk' });

		await offline.flush();

		const cached = await offline.cached();

		expect(cached).toHaveLength(1);
		expect(cached[0].id).toBe('server-1');
	});

	it('repoints queued work at the real id, which would otherwise 404', async () => {
		const offline = store();
		const created = await offline.create({ title: 'Buy milk' });

		// A completion queued behind an in-flight create is the case this exists
		// for: it is addressed to an id the server has not issued yet.
		remote.create = vi.fn(async (payload) => {
			await offline.complete(created.id);

			return { ...task('server-1'), ...payload, id: 'server-1' };
		});

		await offline.flush();
		await offline.flush();

		expect(remote.complete).toHaveBeenCalledWith('server-1');
	});

	it('drops a record the server says is already gone', async () => {
		await kv.set('1', task('1'));
		remote.update = vi.fn(async () => {
			throw new ApiError(404, 'Not found.');
		});

		const offline = store();
		await offline.update('1', { title: 'Renamed' });
		await offline.flush();

		await expect(offline.cached()).resolves.toEqual([]);
	});
});

describe('refreshing', () => {
	it('brings the server list down onto the device', async () => {
		remote = fakeRemote([task('1'), task('2')]);

		const offline = store();
		const records = await offline.refresh();

		expect(records.map((record) => record.id).sort()).toEqual(['1', '2']);
	});

	it('removes a task somebody deleted elsewhere', async () => {
		await kv.set('9', task('9'));
		remote = fakeRemote([task('1')]);

		const offline = store();
		await offline.refresh();

		await expect(offline.get('9')).resolves.toBeNull();
	});

	it('never overwrites a record with work still queued against it', async () => {
		// The server's copy is the stale one here: our edit has not reached it yet.
		await kv.set('1', task('1'));
		remote = fakeRemote([task('1', { title: 'Server copy' })]);

		const offline = store();
		await offline.update('1', { title: 'My edit' });
		await offline.refresh();

		await expect(offline.get('1')).resolves.toMatchObject({ title: 'My edit' });
	});

	it('never deletes a record the server has simply not been told about yet', async () => {
		remote = fakeRemote([]);

		const offline = store();
		const created = await offline.create({ title: 'Buy milk' });
		await offline.refresh();

		await expect(offline.get(created.id)).resolves.toMatchObject({ title: 'Buy milk' });
	});

	it('returns null on a 401 so the caller shows a sign-in, not a connection error', async () => {
		const onUnauthorized = vi.fn();
		remote.listAll = vi.fn(async () => {
			throw new ApiError(401, 'Unauthenticated.');
		});

		await expect(store({ onUnauthorized }).refresh()).resolves.toBeNull();
		expect(onUnauthorized).toHaveBeenCalled();
	});

	it('rethrows a connection failure, which is a different thing entirely', async () => {
		remote.listAll = vi.fn(async () => {
			throw new ApiError(0, 'No connection to the server.');
		});

		await expect(store().refresh()).rejects.toThrow('No connection');
	});

	it('does not delete a record that appeared after the list was asked for', async () => {
		/*
		 * The field report: a task written while the server was down vanished the
		 * moment the server came back, and returned on the next launch.
		 *
		 * A list request issued to a server that is down resolves late. If a
		 * second sync drains the queue while it is still in flight, the new record
		 * is in storage under its server id and no longer queued by the time the
		 * stale answer lands — so it looked like a record the server had deleted.
		 */
		const offline = store();
		let release;
		const hang = new Promise((resolve) => {
			release = resolve;
		});

		remote.listAll = vi.fn(async () => {
			await hang;

			// The answer to a question asked before the record existed.
			return [task('1')];
		});

		const late = offline.refresh();

		await kv.set('server-9', task('server-9', { title: 'Written while it was down' }));
		release();
		await late;

		expect((await kv.all()).map((record) => record.id).sort()).toEqual(['1', 'server-9']);
	});

	it('still removes a record the server really did delete', async () => {
		// The guard above must not turn reconciliation into append-only: a record
		// that was there when we asked, and is absent from the answer, is gone.
		const offline = store();
		await kv.set('1', task('1'));
		await kv.set('2', task('2'));
		remote.listAll = vi.fn(async () => [task('1')]);

		await offline.refresh();

		expect((await kv.all()).map((record) => record.id)).toEqual(['1']);
	});
});

describe('clearing', () => {
	it('throws away the cache and the queue when the session ends', async () => {
		const offline = store();
		await offline.create({ title: 'Buy milk' });

		await offline.clear();

		await expect(offline.cached()).resolves.toEqual([]);
		await expect(offline.pendingCount()).resolves.toBe(0);
	});
});
