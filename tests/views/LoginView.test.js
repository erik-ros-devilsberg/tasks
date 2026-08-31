import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import LoginView from '@/views/LoginView.vue';
import { useSessionStore, TOKEN_KEY } from '@/stores/session';

const { pushMock, replaceMock } = vi.hoisted(() => ({ pushMock: vi.fn(), replaceMock: vi.fn() }));
vi.mock('vue-router', () => ({
	useRouter: () => ({ push: pushMock, replace: replaceMock }),
	useRoute: () => ({ query: {} }),
}));

let fetchMock;

function response(status, body) {
	return {
		ok: status >= 200 && status < 300,
		status,
		text: async () => (body === undefined ? '' : JSON.stringify(body)),
	};
}

function mountView() {
	const pinia = createPinia();
	setActivePinia(pinia);

	return mount(LoginView, { global: { plugins: [pinia] } });
}

async function signIn(wrapper, email = 'ada@example.com', password = 'secret') {
	await wrapper.find('input[type="email"]').setValue(email);
	await wrapper.find('input[type="password"]').setValue(password);
	await wrapper.find('form').trigger('submit');
	await flushPromises();
}

beforeEach(() => {
	localStorage.clear();
	pushMock.mockClear();
	replaceMock.mockClear();
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('signing in', () => {
	it('stores the token and routes to the task list on success', async () => {
		fetchMock.mockResolvedValue(response(200, { token: 'fresh-token' }));
		const wrapper = mountView();

		await signIn(wrapper);

		expect(localStorage.getItem(TOKEN_KEY)).toBe('fresh-token');
		expect(replaceMock).toHaveBeenCalledWith('/');
	});

	it('renders the server message on bad credentials and keeps what was typed', async () => {
		fetchMock.mockResolvedValue(
			response(401, { message: 'These credentials do not match our records.' }),
		);
		const wrapper = mountView();

		await signIn(wrapper);

		expect(wrapper.find('.error').text()).toContain(
			'These credentials do not match our records.',
		);
		expect(wrapper.find('input[type="email"]').element.value).toBe('ada@example.com');
		expect(wrapper.find('input[type="password"]').element.value).toBe('secret');
		expect(replaceMock).not.toHaveBeenCalled();
	});

	it('explains throttling on 429 rather than showing a generic failure', async () => {
		fetchMock.mockResolvedValue(response(429));
		const wrapper = mountView();

		await signIn(wrapper);

		expect(wrapper.text()).toMatch(/too many/i);
	});

	it('says the connection is the problem when there is none, not the credentials', async () => {
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
		const wrapper = mountView();

		await signIn(wrapper);

		expect(wrapper.find('.error').text()).toMatch(/connection/i);
	});

	it('tells the user their session ended rather than leaving them to guess', async () => {
		localStorage.setItem(TOKEN_KEY, 'stale');
		const wrapper = mountView();
		useSessionStore().expired = true;
		await flushPromises();

		expect(wrapper.text()).toMatch(/session/i);
	});

	it('disables the submit button while the request is in flight, so it is sent once', async () => {
		let settle;
		fetchMock.mockReturnValue(new Promise((resolve) => (settle = resolve)));
		const wrapper = mountView();

		await wrapper.find('input[type="email"]').setValue('ada@example.com');
		await wrapper.find('input[type="password"]').setValue('secret');
		await wrapper.find('form').trigger('submit');

		expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined();

		settle(response(200, { token: 'fresh-token' }));
		await flushPromises();
	});
});

describe('password reset', () => {
	it('links out to the server rather than owning a copy of the flow', () => {
		const wrapper = mountView();

		expect(wrapper.find('a[href="/forgot-password"]').exists()).toBe(true);
	});
});
