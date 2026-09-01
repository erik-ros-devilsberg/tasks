import { describe, it, expect, beforeEach } from 'vitest';

import { memoryKv } from '@/lib/kv';
import { createOutbox } from '@/lib/outbox';

let kv;
let outbox;

const AT = '2026-09-01T10:00:00.000Z';

const types = async () => (await outbox.pending()).map((entry) => entry.type);
const payloads = async () => (await outbox.pending()).map((entry) => entry.payload);

beforeEach(() => {
	kv = memoryKv();
	outbox = createOutbox({ kv });
});

describe('queueing', () => {
	it('keeps operations in the order they were made', async () => {
		await outbox.enqueue({ type: 'create', recordId: 'local-1', payload: { title: 'A' } });
		await outbox.enqueue({ type: 'create', recordId: 'local-2', payload: { title: 'B' } });
		await outbox.enqueue({ type: 'delete', recordId: '9' });

		expect(await types()).toEqual(['create', 'create', 'delete']);
	});

	it('continues the sequence after a reload rather than restarting it', async () => {
		// The sequence lives in storage, not in a counter in memory. Restarting it
		// would interleave old and new operations and reorder the queue.
		await outbox.enqueue({ type: 'create', recordId: 'local-1', payload: {} });

		const reloaded = createOutbox({ kv });
		await reloaded.enqueue({ type: 'create', recordId: 'local-2', payload: {} });

		const seqs = (await reloaded.pending()).map((entry) => entry.seq);

		expect(seqs).toEqual([1, 2]);
	});

	it('counts each record once, however many operations it has waiting', async () => {
		await outbox.enqueue({ type: 'create', recordId: 'local-1', payload: {} });
		await outbox.enqueue({ type: 'complete', recordId: 'local-1', payload: { completed_at: AT } });

		await expect(outbox.pendingIds()).resolves.toEqual(['local-1']);
	});
});

describe('coalescing an edit', () => {
	it('sends one request for eight edits to the same task, not eight', async () => {
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'A' } });
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'B' } });

		expect(await types()).toEqual(['update']);
		expect(await payloads()).toEqual([{ title: 'B' }]);
	});

	it('merges the payloads rather than replacing, so a narrower edit drops nothing', async () => {
		// These are PATCH bodies, not full replacements. Replacing outright would
		// lose the notes the first edit carried.
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { notes: 'context' } });
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'Renamed' } });

		expect(await payloads()).toEqual([{ notes: 'context', title: 'Renamed' }]);
	});

	it('folds an edit into a create the server has not seen, which would otherwise 404', async () => {
		await outbox.enqueue({ type: 'create', recordId: 'local-1', payload: { title: 'A' } });
		await outbox.enqueue({ type: 'update', recordId: 'local-1', payload: { title: 'B' } });

		expect(await types()).toEqual(['create']);
		expect(await payloads()).toEqual([{ title: 'B' }]);
	});

	it('leaves two different tasks as two operations', async () => {
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'A' } });
		await outbox.enqueue({ type: 'update', recordId: '2', payload: { title: 'B' } });

		expect(await types()).toEqual(['update', 'update']);
	});
});

describe('coalescing a completion', () => {
	it('keeps only the last word, so ticking and unticking converges on one state', async () => {
		await outbox.enqueue({ type: 'complete', recordId: '1', payload: { completed_at: AT } });
		await outbox.enqueue({ type: 'reopen', recordId: '1', payload: { completed_at: null } });

		expect(await types()).toEqual(['reopen']);
	});

	it('folds a completion into a pending create instead of queueing a second call', async () => {
		// The server has never issued this id. Completing it would 404.
		await outbox.enqueue({ type: 'create', recordId: 'local-1', payload: { title: 'A' } });
		await outbox.enqueue({ type: 'complete', recordId: 'local-1', payload: { completed_at: AT } });

		expect(await types()).toEqual(['create']);
		expect(await payloads()).toEqual([{ title: 'A', completed_at: AT }]);
	});

	it('reopens a locally created task by clearing the field in its create body', async () => {
		await outbox.enqueue({ type: 'create', recordId: 'local-1', payload: { title: 'A' } });
		await outbox.enqueue({ type: 'complete', recordId: 'local-1', payload: { completed_at: AT } });
		await outbox.enqueue({ type: 'reopen', recordId: 'local-1', payload: { completed_at: null } });

		expect(await types()).toEqual(['create']);
		expect(await payloads()).toEqual([{ title: 'A', completed_at: null }]);
	});

	it('keeps an edit and a completion as separate operations, in order', async () => {
		// They are different endpoints: one is a PATCH body, the other is a POST
		// with no body at all. Folding them together would send completed_at in a
		// PATCH, which is how a finished task gets silently reopened.
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'A' } });
		await outbox.enqueue({ type: 'complete', recordId: '1', payload: { completed_at: AT } });

		expect(await types()).toEqual(['update', 'complete']);
	});
});

describe('coalescing a delete', () => {
	it('cancels both operations when the record was only ever created locally', async () => {
		// The server never heard of it, so there is nothing to tell it about.
		await outbox.enqueue({ type: 'create', recordId: 'local-1', payload: { title: 'A' } });
		await outbox.enqueue({ type: 'delete', recordId: 'local-1' });

		expect(await types()).toEqual([]);
	});

	it('drops the edits queued against a record that is about to be deleted', async () => {
		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'A' } });
		await outbox.enqueue({ type: 'complete', recordId: '1', payload: { completed_at: AT } });
		await outbox.enqueue({ type: 'delete', recordId: '1' });

		expect(await types()).toEqual(['delete']);
	});

	it('leaves the queue of another record alone', async () => {
		await outbox.enqueue({ type: 'update', recordId: '2', payload: { title: 'B' } });
		await outbox.enqueue({ type: 'delete', recordId: '1' });

		expect(await types()).toEqual(['update', 'delete']);
	});
});

describe('an operation already in flight', () => {
	it('is never coalesced into, because its payload has already left', async () => {
		// Folding an edit into a request that has gone would drop the edit
		// silently, which is the worst outcome available to us.
		const id = await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'A' } });
		await outbox.markSending(id);

		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'B' } });

		expect(await types()).toEqual(['update', 'update']);
	});

	it('survives a delete on the same record, so the send is not left orphaned', async () => {
		const id = await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'A' } });
		await outbox.markSending(id);

		await outbox.enqueue({ type: 'delete', recordId: '1' });

		expect(await types()).toEqual(['update', 'delete']);
	});

	it('goes back to idle when its send fails, so the next drain picks it up', async () => {
		const id = await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'A' } });
		await outbox.markSending(id);
		await outbox.markIdle(id);

		await outbox.enqueue({ type: 'update', recordId: '1', payload: { title: 'B' } });

		expect(await types()).toEqual(['update']);
	});
});

describe('remapRecordId', () => {
	it('repoints queued work at the id the server issued', async () => {
		// Without this an edit made while the create was in flight would be sent
		// against the temporary id and 404.
		await outbox.enqueue({ type: 'update', recordId: 'local-1', payload: { title: 'B' } });

		await outbox.remapRecordId('local-1', 'server-1');

		expect((await outbox.pending()).map((entry) => entry.recordId)).toEqual(['server-1']);
	});
});

describe('remove and clear', () => {
	it('drops one operation once it has been sent', async () => {
		const id = await outbox.enqueue({ type: 'delete', recordId: '1' });

		await outbox.remove(id);

		expect(await types()).toEqual([]);
	});

	it('empties the queue when the session ends — this device is shared', async () => {
		await outbox.enqueue({ type: 'create', recordId: 'local-1', payload: {} });

		await outbox.clear();

		expect(await types()).toEqual([]);
	});

	it('starts the sequence again after a clear, having thrown its counter away too', async () => {
		await outbox.enqueue({ type: 'create', recordId: 'local-1', payload: {} });
		await outbox.clear();
		await outbox.enqueue({ type: 'create', recordId: 'local-2', payload: {} });

		expect((await outbox.pending()).map((entry) => entry.seq)).toEqual([1]);
	});
});
