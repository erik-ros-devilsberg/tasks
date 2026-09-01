/**
 * The durable, ordered queue of writes waiting to reach the server.
 *
 * Coalescing happens at enqueue rather than at flush. A user who edits the same
 * task eight times offline should send one request, not eight — and the
 * decision has to be made while both operations are still in hand.
 *
 * Five operation types, because tasks have two endpoints an edit cannot express:
 * `create`, `update`, `delete`, `complete` and `reopen`. Completion is kept
 * separate from `update` deliberately — `POST /tasks/{id}/complete` takes no
 * body and lets the server stamp the authoritative time, and an `update` that
 * carried `completed_at` would reopen a finished task the moment it coalesced
 * with an earlier edit.
 */

const SEQ_KEY = '__seq';

const COMPLETION = ['complete', 'reopen'];

/**
 * Operations already flagged `sending` are excluded from coalescing. Their
 * payload has left the building: folding an edit into one would silently drop
 * the edit, which is the worst outcome available to us.
 */
const isCoalescable = (entry, recordId) => entry.recordId === recordId && !entry.sending;

export function createOutbox({ kv }) {
	async function nextSeq() {
		// Derived from storage, not from a counter in memory: a reload must
		// continue the sequence rather than restart it and reorder the queue.
		const current = (await kv.get(SEQ_KEY))?.value ?? 0;
		const next = current + 1;

		await kv.set(SEQ_KEY, { value: next });

		return next;
	}

	async function entries() {
		const all = await kv.all();

		return all.filter((entry) => entry && entry.id !== undefined).sort((a, b) => a.seq - b.seq);
	}

	async function pending() {
		return entries();
	}

	async function enqueue({ type, recordId, payload = null }) {
		const queued = await entries();
		const mine = queued.filter((entry) => isCoalescable(entry, recordId));
		const create = mine.find((entry) => entry.type === 'create');

		if (type === 'delete') {
			if (create) {
				// The server never heard of this record, so both operations cancel.
				for (const entry of mine) {
					await kv.del(entry.id);
				}

				return null;
			}

			// Nothing pending on a record about to be deleted is worth sending.
			for (const entry of mine) {
				await kv.del(entry.id);
			}
		}

		if (type === 'update') {
			if (create) {
				// An update against an id the server has not issued yet would 404.
				await kv.set(create.id, { ...create, payload: { ...create.payload, ...payload } });

				return create.id;
			}

			const update = mine.find((entry) => entry.type === 'update');

			if (update) {
				// Merged, not replaced: these are PATCH bodies, so a narrower
				// second edit must not drop the keys the first one carried.
				await kv.set(update.id, { ...update, payload: { ...update.payload, ...payload } });

				return update.id;
			}
		}

		if (COMPLETION.includes(type)) {
			if (create) {
				// The create body can say whether the task arrives finished, which
				// is one request instead of two against an id that does not exist
				// yet.
				await kv.set(create.id, {
					...create,
					payload: { ...create.payload, completed_at: payload?.completed_at ?? null },
				});

				return create.id;
			}

			// Ticking and unticking a box repeatedly is one decision, not five
			// requests. The last word is the one that converges.
			for (const entry of mine.filter((e) => COMPLETION.includes(e.type))) {
				await kv.del(entry.id);
			}
		}

		const seq = await nextSeq();
		const id = `op-${seq}`;

		await kv.set(id, { id, seq, type, recordId, payload, sending: false });

		return id;
	}

	async function markSending(id) {
		const entry = await kv.get(id);

		if (entry) {
			await kv.set(id, { ...entry, sending: true });
		}
	}

	async function markIdle(id) {
		const entry = await kv.get(id);

		if (entry) {
			await kv.set(id, { ...entry, sending: false });
		}
	}

	async function remove(id) {
		await kv.del(id);
	}

	async function pendingIds() {
		return [...new Set((await entries()).map((entry) => entry.recordId))];
	}

	/**
	 * Called when a create syncs and the server issues a real id. Without this,
	 * an edit made while the create was in flight would be sent against the
	 * temporary id and 404.
	 */
	async function remapRecordId(from, to) {
		for (const entry of await entries()) {
			if (entry.recordId === from) {
				await kv.set(entry.id, { ...entry, recordId: to });
			}
		}
	}

	async function clear() {
		await kv.clear();
	}

	return {
		pending,
		enqueue,
		markSending,
		markIdle,
		remove,
		pendingIds,
		remapRecordId,
		clear,
	};
}
