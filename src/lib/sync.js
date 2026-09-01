/**
 * The drain. Walks the outbox in order and applies a deliberate policy to each
 * failure, because the alternatives all lose data quietly.
 */

export function createSync({ outbox, remote, onUnauthorized = null }) {
	// A single in-flight promise. Start-up and the `online` event routinely fire
	// together, and two concurrent drains would send the same operation twice.
	let inFlight = null;

	async function send(entry) {
		if (entry.type === 'create') {
			return remote.create(entry.payload);
		}

		if (entry.type === 'update') {
			return remote.update(entry.recordId, entry.payload);
		}

		// The completion endpoints, not a PATCH carrying completed_at: the server
		// stamps the authoritative time, and it is idempotent, so a retry after a
		// half-failed drain cannot double-complete anything.
		if (entry.type === 'complete') {
			return remote.complete(entry.recordId);
		}

		if (entry.type === 'reopen') {
			return remote.reopen(entry.recordId);
		}

		return remote.remove(entry.recordId);
	}

	async function drain() {
		const result = { created: [], gone: [], rejected: [], stopped: false };

		for (const entry of await outbox.pending()) {
			// Mark before sending: an edit arriving mid-flight must queue
			// separately rather than be folded into a payload already gone.
			await outbox.markSending(entry.id);

			try {
				const record = await send(entry);

				if (entry.type === 'create' && record) {
					result.created.push({ localId: entry.recordId, record });
				}

				await outbox.remove(entry.id);
			} catch (error) {
				const status = error?.status;

				if (status === 401) {
					// Keep the queue: these writes are still wanted once the
					// user signs back in.
					await outbox.markIdle(entry.id);
					result.stopped = true;
					onUnauthorized?.();

					return result;
				}

				if (status === 404 && entry.type !== 'create') {
					// Already gone server-side. Dropping the operation and
					// reconciling locally is the only outcome that converges.
					// A create is excluded because it cannot 404 on its own id —
					// that is a different fault, and dropping it would throw away
					// a task the user wrote.
					await outbox.remove(entry.id);
					result.gone.push(entry.recordId);

					continue;
				}

				if (status === 422) {
					// A poison operation would otherwise block everything behind
					// it forever. Drop it, but report it — the user made this
					// edit and deserves to hear it did not stick.
					await outbox.remove(entry.id);
					result.rejected.push({ recordId: entry.recordId, message: error.message });

					continue;
				}

				// Transient: 5xx, a dropped connection, anything unexpected.
				// Stop rather than skip, so ordering is preserved.
				await outbox.markIdle(entry.id);
				result.stopped = true;

				return result;
			}
		}

		return result;
	}

	async function flush() {
		if (!inFlight) {
			inFlight = drain().finally(() => {
				inFlight = null;
			});
		}

		return inFlight;
	}

	return { flush };
}
