import { describe, it, expect, vi, beforeEach } from 'vitest';

import { memoryKv } from '@/lib/kv';
import { createOutbox } from '@/lib/outbox';
import { createSync } from '@/lib/sync';
import { ApiError } from '@/lib/api';

let outbox;
let remote;

const AT = '2026-09-01T10:00:00.000Z';

function fakeRemote() {
	return {
		create: vi.fn(async (payload) => ({ id: 'server-1', ...payload })),
		update: vi.fn(async (id, payload) => ({ id, ...payload })),
		complete: vi.fn(async (id) => ({ id, completed_at: AT })),
		reopen: vi.fn(async (id) => ({ id, completed_at: null })),
		remove: vi.fn(async () => null),
	};
}

const sync = (over = {}) => createSync({ outbox, remote, ...over });

const fails = (status) => vi.fn(async () => {
	throw new ApiError(status, `Request failed (${status}).`);
});

beforeEach(() => {
	outbox = createOutbox({ kv: memoryKv() });
	remote = fakeRemote();
});

describe('sending each kind of operation', () => {
	it('creates, and reports the record the server issued', async () => {
		await outbox.enqueue({ type: 'create', recordId: 'local-1', payload: { title: 'A' } });

		const result = await sync().flush();

		expect(remote.create).toHaveBeenCalledWith({ title: 'A' });
		expect(result.created).toEqual([{ localId: 'local-1', record: { id: 'server-1', title: 'A' } }]);
	});

	it('patches an edit rather than replacing the record', async () => {
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'B' } });

		await sync().flush();

		expect(remote.update).toHaveBeenCalledWith('1', { title: 'B' });
	});

	it('completes through the completion endpoint, not through an update', async () => {
		// POST /tasks/{id}/complete takes no body and lets the server stamp the
		// time. Sending completed_at in a PATCH instead would put our clock in
		// the record and reopen the task if that key ever went missing.
		await outbox.enqueue({ type: 'complete', recordId: '1', payload: { completed_at: AT } });

		await sync().flush();

		expect(remote.complete).toHaveBeenCalledWith('1');
		expect(remote.update).not.toHaveBeenCalled();
	});

	it('reopens through its own call', async () => {
		await outbox.enqueue({ type: 'reopen', recordId: '1', payload: { completed_at: null } });

		await sync().flush();

		expect(remote.reopen).toHaveBeenCalledWith('1');
	});

	it('deletes', async () => {
		await outbox.enqueue({ type: 'delete', recordId: '1' });

		await sync().flush();

		expect(remote.remove).toHaveBeenCalledWith('1');
	});

	it('empties the queue as each operation lands', async () => {
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'B' } });
		await outbox.enqueue({ type: 'delete', recordId: '2' });

		await sync().flush();

		await expect(outbox.pending()).resolves.toEqual([]);
	});

	it('sends in the order the user made them', async () => {
		const order = [];
		remote.update = vi.fn(async (id) => order.push(`update:${id}`));
		remote.remove = vi.fn(async (id) => order.push(`delete:${id}`));

		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'B' } });
		await outbox.enqueue({ type: 'delete', recordId: '2' });

		await sync().flush();

		expect(order).toEqual(['update:1', 'delete:2']);
	});
});

describe('one drain at a time', () => {
	it('does not send the same operation twice when two drains start together', async () => {
		// Start-up and the `online` event routinely fire at the same moment.
		await outbox.enqueue({ type: 'delete', recordId: '1' });

		const drain = sync();
		await Promise.all([drain.flush(), drain.flush()]);

		expect(remote.remove).toHaveBeenCalledTimes(1);
	});
});

describe('failure policy', () => {
	it('stops on a 401 and keeps the queue — these writes are still wanted', async () => {
		remote.update = fails(401);
		const onUnauthorized = vi.fn();
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'B' } });

		const result = await sync({ onUnauthorized }).flush();

		expect(result.stopped).toBe(true);
		expect(onUnauthorized).toHaveBeenCalled();
		expect(await outbox.pending()).toHaveLength(1);
	});

	it('leaves a 401 operation idle so the next drain retries it', async () => {
		remote.update = fails(401);
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'B' } });

		await sync().flush();

		expect((await outbox.pending())[0].sending).toBe(false);
	});

	it('treats a 404 on an update as already gone and reconciles locally', async () => {
		remote.update = fails(404);
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'B' } });

		const result = await sync().flush();

		expect(result.gone).toEqual(['1']);
		expect(await outbox.pending()).toEqual([]);
	});

	it('treats a 404 on a delete as the outcome that was asked for', async () => {
		remote.remove = fails(404);
		await outbox.enqueue({ type: 'delete', recordId: '1' });

		const result = await sync().flush();

		expect(result.gone).toEqual(['1']);
	});

	it('stops on a 404 for a create, because that is not a record going missing', async () => {
		// A create cannot 404 on its own id. Something else is wrong, and dropping
		// the operation would throw away a task the user wrote.
		remote.create = fails(404);
		await outbox.enqueue({ type: 'create', recordId: 'local-1', payload: { title: 'A' } });

		const result = await sync().flush();

		expect(result.stopped).toBe(true);
		expect(result.gone).toEqual([]);
		expect(await outbox.pending()).toHaveLength(1);
	});

	it('drops a 422 rather than letting it block everything behind it forever', async () => {
		remote.update = fails(422);
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'B' } });
		await outbox.enqueue({ type: 'delete', recordId: '2' });

		const result = await sync().flush();

		expect(result.rejected).toHaveLength(1);
		expect(result.rejected[0].recordId).toBe('1');
		// Everything behind the poison operation still went.
		expect(remote.remove).toHaveBeenCalledWith('2');
	});

	it('reports a rejected change rather than swallowing it — the user made that edit', async () => {
		remote.update = fails(422);
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'B' } });

		const result = await sync().flush();

		expect(result.rejected[0].message).toContain('422');
	});

	it('stops on a dropped connection rather than skipping ahead, so ordering holds', async () => {
		remote.update = fails(0);
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'B' } });
		await outbox.enqueue({ type: 'delete', recordId: '2' });

		const result = await sync().flush();

		expect(result.stopped).toBe(true);
		expect(remote.remove).not.toHaveBeenCalled();
		expect(await outbox.pending()).toHaveLength(2);
	});

	it('stops on a 500 for the same reason', async () => {
		remote.update = fails(500);
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'B' } });

		const result = await sync().flush();

		expect(result.stopped).toBe(true);
		expect((await outbox.pending())[0].sending).toBe(false);
	});

	it('retries what it stopped on when the connection comes back', async () => {
		remote.update = fails(0);
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'B' } });

		const drain = sync();
		await drain.flush();

		remote.update = vi.fn(async () => ({ id: '1' }));
		const second = await drain.flush();

		expect(remote.update).toHaveBeenCalledWith('1', { title: 'B' });
		expect(second.stopped).toBe(false);
	});
});

describe('marking an operation in flight', () => {
	it('flags it before sending, so an edit arriving mid-flight queues separately', async () => {
		let sendingDuring = null;

		remote.update = vi.fn(async () => {
			sendingDuring = (await outbox.pending())[0].sending;

			return { id: '1' };
		});

		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'B' } });
		await sync().flush();

		expect(sendingDuring).toBe(true);
	});
});
