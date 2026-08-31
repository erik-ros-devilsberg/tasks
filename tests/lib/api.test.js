import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createApi, ApiError, isOffline, API_BASE } from '@/lib/api';

let fetchMock;

function response(status, body) {
	return {
		ok: status >= 200 && status < 300,
		status,
		text: async () => (body === undefined ? '' : JSON.stringify(body)),
	};
}

const lastCall = () => fetchMock.mock.calls.at(-1);

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('request headers', () => {
	it('prefixes every path with the versioned API base', async () => {
		fetchMock.mockResolvedValue(response(200, []));
		const api = createApi();

		await api.get('/tasks');

		expect(lastCall()[0]).toBe(`${API_BASE}/tasks`);
	});

	it('asks for JSON, so Laravel answers with JSON rather than an HTML error page', async () => {
		fetchMock.mockResolvedValue(response(200, []));
		const api = createApi();

		await api.get('/tasks');

		expect(lastCall()[1].headers.Accept).toBe('application/json');
	});

	it('attaches the bearer token when one is held', async () => {
		fetchMock.mockResolvedValue(response(200, []));
		const api = createApi({ getToken: () => 'a-token' });

		await api.get('/tasks');

		expect(lastCall()[1].headers.Authorization).toBe('Bearer a-token');
	});

	it('omits the Authorization header entirely when signed out', async () => {
		fetchMock.mockResolvedValue(response(200, {}));
		const api = createApi({ getToken: () => null });

		await api.post('/login', { email: 'ada@example.com', password: 'secret' });

		expect(lastCall()[1].headers.Authorization).toBeUndefined();
	});

	it('sends no Content-Type on a bodyless request — the complete endpoint takes no body', async () => {
		fetchMock.mockResolvedValue(response(200, {}));
		const api = createApi();

		await api.post('/tasks/1/complete');

		expect(lastCall()[1].body).toBeUndefined();
		expect(lastCall()[1].headers['Content-Type']).toBeUndefined();
	});
});

describe('responses', () => {
	it('returns the parsed body on success', async () => {
		fetchMock.mockResolvedValue(response(200, { id: '1', title: 'Buy milk' }));
		const api = createApi();

		await expect(api.get('/tasks/1')).resolves.toEqual({ id: '1', title: 'Buy milk' });
	});

	it('returns null for 204, which delete and logout both answer with', async () => {
		fetchMock.mockResolvedValue(response(204));
		const api = createApi();

		await expect(api.del('/tasks/1')).resolves.toBeNull();
	});

	it('survives a non-JSON body rather than throwing a parse error at the user', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '<html>' });
		const api = createApi();

		await expect(api.get('/tasks')).resolves.toBeNull();
	});
});

describe('failures', () => {
	it('reports the status so callers can tell 404 from 422 from 500', async () => {
		fetchMock.mockResolvedValue(response(422, { message: 'The title is too long.' }));
		const api = createApi();

		await expect(api.get('/tasks')).rejects.toMatchObject({
			status: 422,
			message: 'The title is too long.',
		});
	});

	it('carries the server payload, so a 422 can be shown against its fields', async () => {
		fetchMock.mockResolvedValue(response(422, { errors: { title: ['Too long.'] } }));
		const api = createApi();

		await expect(api.get('/tasks')).rejects.toMatchObject({
			data: { errors: { title: ['Too long.'] } },
		});
	});

	it('falls back to a readable message when the server sends none', async () => {
		fetchMock.mockResolvedValue(response(500));
		const api = createApi();

		await expect(api.get('/tasks')).rejects.toThrow(/500/);
	});

	it('reports a dropped connection as status 0, not as a thrown TypeError', async () => {
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
		const api = createApi();

		const failure = await api.get('/tasks').catch((error) => error);

		expect(failure).toBeInstanceOf(ApiError);
		expect(failure.status).toBe(0);
		expect(isOffline(failure)).toBe(true);
	});

	it('calls onUnauthorized once on 401, so the session is cleared in one place', async () => {
		fetchMock.mockResolvedValue(response(401, { message: 'Unauthenticated.' }));
		const onUnauthorized = vi.fn();
		const api = createApi({ onUnauthorized });

		await api.get('/tasks').catch(() => {});

		expect(onUnauthorized).toHaveBeenCalledOnce();
	});

	it('leaves onUnauthorized alone on any other status', async () => {
		fetchMock.mockResolvedValue(response(403, {}));
		const onUnauthorized = vi.fn();
		const api = createApi({ onUnauthorized });

		await api.get('/tasks').catch(() => {});

		expect(onUnauthorized).not.toHaveBeenCalled();
	});
});
