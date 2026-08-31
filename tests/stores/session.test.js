import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useSessionStore, TOKEN_KEY } from '@/stores/session';

let fetchMock;

function response(status, body) {
	return {
		ok: status >= 200 && status < 300,
		status,
		text: async () => (body === undefined ? '' : JSON.stringify(body)),
	};
}

beforeEach(() => {
	localStorage.clear();
	setActivePinia(createPinia());
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('login', () => {
	it('persists the token so a reload does not sign the user out', async () => {
		fetchMock.mockResolvedValue(response(200, { token: 'fresh-token' }));
		const session = useSessionStore();

		await session.login('ada@example.com', 'secret');

		expect(session.token).toBe('fresh-token');
		expect(session.isAuthenticated).toBe(true);
		expect(localStorage.getItem(TOKEN_KEY)).toBe('fresh-token');
	});

	it('reads a stored token back at construction — that is what survives a reload', () => {
		localStorage.setItem(TOKEN_KEY, 'stored-token');

		const session = useSessionStore();

		expect(session.token).toBe('stored-token');
		expect(session.isAuthenticated).toBe(true);
	});

	it('passes the server message through on bad credentials rather than inventing one', async () => {
		fetchMock.mockResolvedValue(
			response(401, { message: 'These credentials do not match our records.' }),
		);
		const session = useSessionStore();

		await expect(session.login('ada@example.com', 'wrong')).rejects.toThrow(
			'These credentials do not match our records.',
		);
		expect(session.isAuthenticated).toBe(false);
	});

	it('explains the 6/min throttle on 429, which the server answers with an empty body', async () => {
		fetchMock.mockResolvedValue(response(429));
		const session = useSessionStore();

		const failure = await session.login('ada@example.com', 'secret').catch((error) => error);

		expect(failure.status).toBe(429);
		expect(failure.message).toMatch(/too many/i);
	});
});

describe('logout', () => {
	it('revokes the token on the server and clears it here', async () => {
		localStorage.setItem(TOKEN_KEY, 'stored-token');
		fetchMock.mockResolvedValue(response(204));
		const session = useSessionStore();

		await session.logout();

		expect(fetchMock.mock.calls.at(-1)[0]).toContain('/logout');
		expect(session.token).toBeNull();
		expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
	});

	it('signs out locally even when the request fails — a dead network must not trap the user', async () => {
		localStorage.setItem(TOKEN_KEY, 'stored-token');
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
		const session = useSessionStore();

		await session.logout();

		expect(session.token).toBeNull();
		expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
	});
});

describe('an expired session', () => {
	it('clears the token when any authenticated call answers 401', async () => {
		localStorage.setItem(TOKEN_KEY, 'stale-token');
		fetchMock.mockResolvedValue(response(401, { message: 'Unauthenticated.' }));
		const session = useSessionStore();

		await session.api.get('/tasks').catch(() => {});

		expect(session.token).toBeNull();
		expect(session.expired).toBe(true);
		expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
	});

	it('drops the expired flag on the next sign-in attempt, so the notice does not linger', async () => {
		fetchMock.mockResolvedValue(response(200, { token: 'fresh-token' }));
		const session = useSessionStore();
		session.expired = true;

		await session.login('ada@example.com', 'secret');

		expect(session.expired).toBe(false);
	});
});
