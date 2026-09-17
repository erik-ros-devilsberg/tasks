import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createApi } from '@/lib/api';
import { createTasksRemote } from '@/lib/tasksRemote';

let fetchMock;

function response(status, body) {
	return {
		ok: status >= 200 && status < 300,
		status,
		text: async () => (body === undefined ? '' : JSON.stringify(body)),
	};
}

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

const lastCall = () => fetchMock.mock.calls.at(-1);
const lastBody = () => JSON.parse(lastCall()[1].body);

function remote() {
	return createTasksRemote({ api: createApi() });
}

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('listAll', () => {
	it('fetches the whole list in one request — the endpoint is not paginated', async () => {
		fetchMock.mockResolvedValue(response(200, [task('1'), task('2')]));

		const tasks = await remote().listAll();

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(tasks.map((t) => t.id)).toEqual(['1', '2']);
	});

	it('asks for no page parameter, so a paginated server would still be a bug we notice', async () => {
		fetchMock.mockResolvedValue(response(200, []));

		await remote().listAll();

		expect(lastCall()[0]).toBe('/api/v1/tasks');
	});

	it('unwraps a { data } envelope, so the pagination removal can land either way', async () => {
		fetchMock.mockResolvedValue(response(200, { data: [task('1')] }));

		const tasks = await remote().listAll();

		expect(tasks.map((t) => t.id)).toEqual(['1']);
	});

	it('returns an empty array rather than null when the account has no tasks', async () => {
		fetchMock.mockResolvedValue(response(200, []));

		await expect(remote().listAll()).resolves.toEqual([]);
	});
});

/*
 * Every single-record endpoint answers with a Laravel resource envelope,
 * `{ data: { … } }`. The 2026-09-17 disappearing-task bug was `create`
 * returning the envelope whole: `record.id` was undefined, IndexedDB refused
 * the key, and the local copy had already been deleted.
 */
describe('the { data } envelope on single records', () => {
	const wrapped = (record) => ({ data: record });

	it('unwraps a created task, so the sync gets a record with an id', async () => {
		fetchMock.mockResolvedValue(response(201, wrapped(task('9', { title: 'New' }))));

		const created = await remote().create({ title: 'New' });

		expect(created.id).toBe('9');
		expect(created.data).toBeUndefined();
	});

	it('unwraps a fetched task', async () => {
		fetchMock.mockResolvedValue(response(200, wrapped(task('9'))));

		expect((await remote().get('9')).id).toBe('9');
	});

	it('unwraps a patched task', async () => {
		fetchMock.mockResolvedValue(response(200, wrapped(task('9', { notes: 'x' }))));

		expect((await remote().update('9', { notes: 'x' })).notes).toBe('x');
	});

	it('unwraps a replaced task', async () => {
		fetchMock.mockResolvedValue(response(200, wrapped(task('9'))));

		expect((await remote().replace('9', task('9'))).id).toBe('9');
	});

	it('unwraps a completed task', async () => {
		fetchMock.mockResolvedValue(response(200, wrapped(task('9', { completed_at: '2026-09-17T04:00:00Z' }))));

		expect((await remote().complete('9')).completed_at).toBe('2026-09-17T04:00:00Z');
	});

	it('unwraps a reopened task', async () => {
		fetchMock.mockResolvedValue(response(200, wrapped(task('9'))));

		expect((await remote().reopen('9')).completed_at).toBeNull();
	});

	it('still accepts a bare record, so the server can drop the envelope without a lockstep deploy', async () => {
		fetchMock.mockResolvedValue(response(201, task('9')));

		expect((await remote().create({})).id).toBe('9');
	});
});

describe('create', () => {
	it('posts the body and returns the created task', async () => {
		fetchMock.mockResolvedValue(response(201, task('1', { title: 'Buy milk' })));

		const created = await remote().create({ title: 'Buy milk' });

		expect(lastCall()[1].method).toBe('POST');
		expect(lastBody()).toEqual({ title: 'Buy milk' });
		expect(created.title).toBe('Buy milk');
	});

	it('accepts an empty create — the server defaults the title rather than refusing', async () => {
		fetchMock.mockResolvedValue(response(201, task('1', { title: 'Untitled task' })));

		const created = await remote().create({});

		expect(created.title).toBe('Untitled task');
	});
});

describe('update', () => {
	it('uses PATCH, so omitted fields are left alone rather than wiped', async () => {
		fetchMock.mockResolvedValue(response(200, task('1', { title: 'Renamed' })));

		await remote().update('1', { title: 'Renamed' });

		expect(lastCall()[1].method).toBe('PATCH');
		expect(lastCall()[0]).toBe('/api/v1/tasks/1');
	});

	it('does not reopen a completed task when only the title changes', async () => {
		const completed = task('1', { completed_at: '2026-08-30T10:00:00.000000Z' });
		fetchMock.mockResolvedValue(response(200, { ...completed, title: 'Renamed' }));

		const saved = await remote().update('1', { title: 'Renamed' });

		// The danger is a PUT that omits completed_at: the server treats that as
		// a full replacement and reopens the task.
		expect(lastBody()).not.toHaveProperty('completed_at');
		expect(lastCall()[1].method).toBe('PATCH');
		expect(saved.completed_at).toBe('2026-08-30T10:00:00.000000Z');
	});

	it('sends a complete body including completed_at when replacing outright', async () => {
		const completed = task('1', { completed_at: '2026-08-30T10:00:00.000000Z' });
		fetchMock.mockResolvedValue(response(200, completed));

		await remote().replace('1', completed);

		expect(lastCall()[1].method).toBe('PUT');
		expect(lastBody()).toMatchObject({
			title: 'Task 1',
			notes: null,
			due_at: null,
			duration: null,
			completed_at: '2026-08-30T10:00:00.000000Z',
		});
	});

	it('carries order through a replacement — PUT is a full body, and an absent key clears it', async () => {
		const ordered = task('1', { order: 3 });
		fetchMock.mockResolvedValue(response(200, ordered));

		await remote().replace('1', ordered);

		expect(lastBody()).toHaveProperty('order', 3);
	});

	it('sends order as an explicit null when the task has none, never as an absent key', async () => {
		fetchMock.mockResolvedValue(response(200, task('1')));

		await remote().replace('1', task('1'));

		expect(lastBody()).toHaveProperty('order', null);
	});

	it('carries duration through a replacement, which would otherwise wipe it', async () => {
		// PUT is a full replacement: a field left out of the body is reset, so an
		// estimate the user recorded would vanish on the next full save.
		const estimated = task('1', { duration: 45 });
		fetchMock.mockResolvedValue(response(200, estimated));

		await remote().replace('1', estimated);

		expect(lastBody().duration).toBe(45);
	});
});

describe('duration', () => {
	it('sends a duration on create and returns what the server stored', async () => {
		fetchMock.mockResolvedValue(response(201, task('1', { duration: 45 })));

		const created = await remote().create({ title: 'Write docs', duration: 45 });

		expect(lastBody().duration).toBe(45);
		expect(created.duration).toBe(45);
	});

	it('clears a duration with an explicit null rather than by omitting the key', async () => {
		// An absent key leaves a PATCH field unchanged. Only an explicit null
		// clears it, so "I no longer know how long this takes" has to be said.
		fetchMock.mockResolvedValue(response(200, task('1', { duration: null })));

		await remote().update('1', { duration: null });

		expect(lastBody()).toHaveProperty('duration', null);
	});

	it('leaves a duration alone when only the title is patched', async () => {
		fetchMock.mockResolvedValue(response(200, task('1', { title: 'Renamed', duration: 45 })));

		const saved = await remote().update('1', { title: 'Renamed' });

		expect(lastBody()).not.toHaveProperty('duration');
		expect(saved.duration).toBe(45);
	});
});

describe('due_at granularity', () => {
	it('sends a date-only due date unchanged — it must not become a midnight datetime', async () => {
		fetchMock.mockResolvedValue(response(201, task('1', { due_at: '2026-09-01' })));

		const created = await remote().create({ title: 'Pay rent', due_at: '2026-09-01' });

		expect(lastBody().due_at).toBe('2026-09-01');
		expect(created.due_at).toBe('2026-09-01');
	});

	it('sends a datetime due date unchanged — it must not be truncated to a date', async () => {
		const at = '2026-09-01T14:30:00.000000Z';
		fetchMock.mockResolvedValue(response(201, task('1', { due_at: at })));

		const created = await remote().create({ title: 'Standup', due_at: at });

		expect(lastBody().due_at).toBe(at);
		expect(created.due_at).toBe(at);
	});
});

describe('complete', () => {
	it('posts with no body at all — the endpoint takes none', async () => {
		fetchMock.mockResolvedValue(response(200, task('1', { completed_at: '2026-08-30T10:00:00.000000Z' })));

		await remote().complete('1');

		expect(lastCall()[0]).toBe('/api/v1/tasks/1/complete');
		expect(lastCall()[1].method).toBe('POST');
		expect(lastCall()[1].body).toBeUndefined();
	});

	it('is idempotent — completing twice is not an error', async () => {
		const done = task('1', { completed_at: '2026-08-30T10:00:00.000000Z' });
		fetchMock.mockResolvedValue(response(200, done));
		const tasks = remote();

		await tasks.complete('1');

		await expect(tasks.complete('1')).resolves.toMatchObject({ id: '1' });
	});
});

describe('reopen', () => {
	it('clears completed_at with a PATCH rather than a field-dropping PUT', async () => {
		fetchMock.mockResolvedValue(response(200, task('1')));

		await remote().reopen('1');

		expect(lastCall()[1].method).toBe('PATCH');
		expect(lastBody()).toEqual({ completed_at: null });
	});
});

describe('remove', () => {
	it('treats 204 as success', async () => {
		fetchMock.mockResolvedValue(response(204));

		await expect(remote().remove('1')).resolves.toBeNull();
		expect(lastCall()[1].method).toBe('DELETE');
	});

	it('treats 404 as success — the task is already gone, and saying otherwise helps nobody', async () => {
		fetchMock.mockResolvedValue(response(404, { message: 'Not found.' }));

		await expect(remote().remove('1')).resolves.toBeNull();
	});
});

describe('failures', () => {
	it.each([
		['401', 401],
		['404', 404],
		['422', 422],
		['500', 500],
	])('surfaces %s to the caller with its status', async (_label, status) => {
		fetchMock.mockResolvedValue(response(status, { message: 'No.' }));

		await expect(remote().get('1')).rejects.toMatchObject({ status });
	});

	it('reports a dropped connection as status 0 rather than a thrown TypeError', async () => {
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

		await expect(remote().listAll()).rejects.toMatchObject({ status: 0 });
	});
});
