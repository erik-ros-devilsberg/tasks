/**
 * The durable store: the device is the source of truth for reads, and the
 * network is a background concern.
 *
 * Not to be confused with the Pinia store, which is the in-memory reactive
 * layer above this one. This is what survives a reload.
 *
 * Operations carry a `recordId` and an opaque `payload`; the caller supplies
 * its own remote, storage and ordering.
 */

import { createOutbox } from '@/lib/outbox';
import { createSync } from '@/lib/sync';

let counter = 0;

/**
 * Records created offline need an id before the server can issue one. The
 * `local-` prefix is load-bearing: it is how the rest of the app recognises a
 * record the server has never heard of.
 */
function localId() {
	counter += 1;

	return `local-${Date.now()}-${counter}`;
}

export const isLocalId = (id) => typeof id === 'string' && id.startsWith('local-');

/**
 * An edit never carries the completion state.
 *
 * `completed_at` has its own two operations and its own endpoints. Letting it
 * into a PATCH body is how a finished task gets silently reopened — the form
 * sends a whole record, the outbox coalesces it with an older edit, and the
 * stale `null` wins.
 */
function withoutCompletion(payload) {
	const fields = { ...(payload ?? {}) };

	delete fields.completed_at;

	return fields;
}

export function createOfflineStore({
	kv,
	outboxKv,
	remote,
	sort = null,
	onUnauthorized = null,
	now = () => new Date().toISOString(),
}) {
	const outbox = createOutbox({ kv: outboxKv });
	const sync = createSync({ outbox, remote, onUnauthorized });

	async function cached() {
		const records = await kv.all();

		return sort ? records.sort(sort) : records;
	}

	async function get(id) {
		return kv.get(id);
	}

	async function pendingIds() {
		return outbox.pendingIds();
	}

	async function pendingCount() {
		return (await outbox.pending()).length;
	}

	async function create(payload) {
		const id = localId();
		// Open unless the payload says otherwise: every consumer reads completion
		// off this field, and an absent one would be a task with no state at all.
		const record = { completed_at: null, ...payload, id };

		await kv.set(id, record);
		await outbox.enqueue({ type: 'create', recordId: id, payload });

		return record;
	}

	async function update(id, payload) {
		const held = await kv.get(id);
		const fields = withoutCompletion(payload);
		const record = { ...held, ...fields, id };

		await kv.set(id, record);
		await outbox.enqueue({ type: 'update', recordId: id, payload: fields });

		return record;
	}

	/**
	 * Stamps the moment the box was ticked rather than the moment a connection
	 * came back — that is when the user finished the task, and it is what keeps
	 * the list in a sensible order in the meantime. The stamp is a placeholder:
	 * the server writes its own on sync, and that one is authoritative.
	 */
	async function setCompletion(id, completed_at, type) {
		const held = await kv.get(id);

		// Nothing to complete. Queueing an operation for a record we do not hold
		// would send the server a change nobody can see or undo.
		if (!held) {
			return null;
		}

		const record = { ...held, completed_at };

		await kv.set(id, record);
		await outbox.enqueue({ type, recordId: id, payload: { completed_at } });

		return record;
	}

	const complete = (id) => setCompletion(id, now(), 'complete');

	const reopen = (id) => setCompletion(id, null, 'reopen');

	async function remove(id) {
		await kv.del(id);
		await outbox.enqueue({ type: 'delete', recordId: id });
	}

	async function flush() {
		const result = await sync.flush();

		for (const { localId: temporary, record } of result.created) {
			// The server's record replaces the temporary one, and anything still
			// queued against the temporary id is repointed — otherwise a
			// completion made while the create was in flight would 404.
			await kv.del(temporary);
			await kv.set(record.id, record);
			await outbox.remapRecordId(temporary, record.id);
		}

		for (const id of result.gone) {
			await kv.del(id);
		}

		return result;
	}

	/**
	 * Reconciles with the server. Returns null on 401 so callers can fall
	 * through to the login screen rather than showing a connection error.
	 */
	async function refresh() {
		let records;

		try {
			records = await remote.listAll();
		} catch (error) {
			if (error?.status === 401) {
				onUnauthorized?.();

				return null;
			}

			throw error;
		}

		// Records with queued work are skipped in both directions: upserting one
		// would overwrite an offline edit with the server's stale copy, and
		// deleting one would remove a record the server has never heard of.
		const pending = new Set(await outbox.pendingIds());
		const seen = new Set();

		for (const record of records) {
			seen.add(record.id);

			if (!pending.has(record.id)) {
				await kv.set(record.id, record);
			}
		}

		for (const id of await kv.keys()) {
			if (!seen.has(id) && !pending.has(id)) {
				await kv.del(id);
			}
		}

		return cached();
	}

	async function clear() {
		await kv.clear();
		await outbox.clear();
	}

	return {
		cached,
		get,
		refresh,
		create,
		update,
		complete,
		reopen,
		remove,
		flush,
		pendingIds,
		pendingCount,
		clear,
	};
}
