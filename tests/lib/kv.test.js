import { describe, it, expect, beforeEach } from 'vitest';

import { createKv, memoryKv } from '@/lib/kv';

let kv;

beforeEach(() => {
	kv = memoryKv();
});

describe('the six methods every adapter has to satisfy', () => {
	it('returns null for a key it was never given, rather than undefined', async () => {
		// Every caller branches on null. Two absent values would mean two branches.
		await expect(kv.get('missing')).resolves.toBeNull();
	});

	it('stores and reads a record back', async () => {
		await kv.set('1', { id: '1', title: 'Buy milk' });

		await expect(kv.get('1')).resolves.toEqual({ id: '1', title: 'Buy milk' });
	});

	it('overwrites rather than merging, because a record is stored whole', async () => {
		await kv.set('1', { id: '1', title: 'Buy milk', notes: 'semi-skimmed' });
		await kv.set('1', { id: '1', title: 'Buy bread' });

		await expect(kv.get('1')).resolves.toEqual({ id: '1', title: 'Buy bread' });
	});

	it('deletes a key', async () => {
		await kv.set('1', { id: '1' });
		await kv.del('1');

		await expect(kv.get('1')).resolves.toBeNull();
	});

	it('lists every value it holds', async () => {
		await kv.set('1', { id: '1' });
		await kv.set('2', { id: '2' });

		const all = await kv.all();

		expect(all.map((record) => record.id).sort()).toEqual(['1', '2']);
	});

	it('lists its keys', async () => {
		await kv.set('1', { id: '1' });

		await expect(kv.keys()).resolves.toEqual(['1']);
	});

	it('empties itself', async () => {
		await kv.set('1', { id: '1' });
		await kv.clear();

		await expect(kv.all()).resolves.toEqual([]);
	});
});

describe('what comes back is a copy', () => {
	it('hands back a clone, so a caller cannot mutate storage by accident', async () => {
		// Without this a view that edits the object it rendered would silently
		// rewrite the cached record without ever going through an operation.
		await kv.set('1', { id: '1', title: 'Buy milk' });

		const first = await kv.get('1');
		first.title = 'Tampered';

		await expect(kv.get('1')).resolves.toEqual({ id: '1', title: 'Buy milk' });
	});

	it('stores a clone, so mutating what was passed in does not change what is held', async () => {
		const record = { id: '1', title: 'Buy milk' };
		await kv.set('1', record);

		record.title = 'Tampered';

		await expect(kv.get('1')).resolves.toEqual({ id: '1', title: 'Buy milk' });
	});
});

describe('createKv', () => {
	it('falls back to memory when IndexedDB is missing, rather than refusing to run', async () => {
		// A private window with storage disabled should still get a working app for
		// the session. Losing the cache beats a blank screen.
		const fallback = createKv('coevta-tasks', 'tasks');

		await fallback.set('1', { id: '1' });

		await expect(fallback.get('1')).resolves.toEqual({ id: '1' });
	});
});
