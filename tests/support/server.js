import { vi } from 'vitest';

/**
 * A small in-memory server, shared by the tests that drive a whole sync.
 *
 * A bag of unrelated stubs does not work once the app pushes and pulls in the
 * same operation: a `listAll` that does not reflect the `create` it just
 * accepted would make every round-trip assertion lie. `records` is exposed so a
 * test can simulate somebody else changing things.
 */

export const SERVER_AT = '2026-09-01T10:00:00.000Z';

export const task = (id, over = {}) => ({
	id,
	title: `Task ${id}`,
	notes: null,
	due_at: null,
	duration: null,
	completed_at: null,
	...over,
});

export function fakeServer(initial = []) {
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

/** A remote method that fails the way the API client reports failures. */
export const failing = (status) =>
	vi.fn(async () => {
		throw Object.assign(new Error(`Request failed (${status}).`), { status });
	});
