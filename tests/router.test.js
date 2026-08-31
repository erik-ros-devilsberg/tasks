import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { authGuard, router } from '@/router';
import { TOKEN_KEY } from '@/stores/session';

const to = (path, meta = {}) => ({ path, meta });

beforeEach(() => {
	localStorage.clear();
	setActivePinia(createPinia());
});

describe('routes', () => {
	it('resolves the root path to the task list — the app opens on the work, not a menu', () => {
		expect(router.resolve('/').name).toBe('tasks');
	});

	it('has a login route marked public, or the guard would redirect it to itself', () => {
		expect(router.resolve('/login').meta.public).toBe(true);
	});
});

describe('the auth guard', () => {
	it('sends a signed-out visitor to login', () => {
		expect(authGuard(to('/'))).toBe('/login');
	});

	it('lets a signed-out visitor reach a public route', () => {
		expect(authGuard(to('/login', { public: true }))).toBe(true);
	});

	it('lets a signed-in user through to the task list', () => {
		localStorage.setItem(TOKEN_KEY, 'a-token');

		expect(authGuard(to('/'))).toBe(true);
	});

	it('sends a signed-in user away from login rather than showing a pointless form', () => {
		localStorage.setItem(TOKEN_KEY, 'a-token');

		expect(authGuard(to('/login', { public: true }))).toBe('/');
	});
});
