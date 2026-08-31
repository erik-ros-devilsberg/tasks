import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import App from '@/App.vue';
import { TOKEN_KEY } from '@/stores/session';
import { useRemote, useTasksStore } from '@/stores/tasks';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));
vi.mock('vue-router', () => ({
	useRouter: () => ({ replace: replaceMock }),
	RouterView: { template: '<div />' },
	RouterLink: { template: '<a><slot /></a>' },
}));

function fakeRemote(over = {}) {
	return {
		listAll: vi.fn().mockResolvedValue([]),
		get: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		replace: vi.fn(),
		complete: vi.fn(),
		reopen: vi.fn(),
		remove: vi.fn().mockResolvedValue(null),
		...over,
	};
}

function mountApp(remote = fakeRemote()) {
	const pinia = createPinia();
	setActivePinia(pinia);
	useRemote(remote);

	return mount(App, {
		attachTo: document.body,
		global: { plugins: [pinia], stubs: { RouterView: true, RouterLink: true } },
	});
}

/** Signed in, with the menu already open — the state most of these start from. */
async function withMenuOpen(remote = fakeRemote()) {
	localStorage.setItem(TOKEN_KEY, 'a-token');
	const wrapper = mountApp(remote);
	await wrapper.find('[data-action="menu"]').trigger('click');

	return wrapper;
}

function vueFiles(dir) {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);

		if (statSync(path).isDirectory()) {
			return vueFiles(path);
		}

		return path.endsWith('.vue') ? [path] : [];
	});
}

beforeEach(() => {
	localStorage.clear();
	replaceMock.mockClear();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('app shell', () => {
	it('renders the router outlet, so every route has somewhere to mount', () => {
		const wrapper = mountApp();

		expect(wrapper.findComponent({ name: 'RouterView' }).exists()).toBe(true);
	});

	it('renders semantic landmarks (nav and main) rather than anonymous divs', () => {
		const wrapper = mountApp();

		expect(wrapper.find('nav').exists()).toBe(true);
		expect(wrapper.find('main').exists()).toBe(true);
	});

	it('offers a skip link pointing at the main region, for keyboard users', () => {
		const wrapper = mountApp();

		expect(wrapper.find('a[href="#main"]').exists()).toBe(true);
		expect(wrapper.find('main').attributes('id')).toBe('main');
	});

	it('shows the build version in the footer, out of the way of navigation', () => {
		const wrapper = mountApp();

		expect(wrapper.find('footer').text()).toContain(__APP_VERSION__);
		expect(wrapper.find('nav').text()).not.toContain(__APP_VERSION__);
	});

	it('names the app once — the wordmark is the heading, the view does not repeat it', () => {
		const wrapper = mountApp();

		expect(wrapper.findAll('.wordmark')).toHaveLength(1);
	});
});

describe('the menu', () => {
	it('is offered only when there is a session to act on', () => {
		expect(mountApp().find('[data-action="menu"]').exists()).toBe(false);

		localStorage.setItem(TOKEN_KEY, 'a-token');

		expect(mountApp().find('[data-action="menu"]').exists()).toBe(true);
	});

	it('stays shut until asked for, and says which it is', async () => {
		localStorage.setItem(TOKEN_KEY, 'a-token');
		const wrapper = mountApp();
		const button = wrapper.find('[data-action="menu"]');

		expect(wrapper.find('.menu').exists()).toBe(false);
		expect(button.attributes('aria-expanded')).toBe('false');

		await button.trigger('click');

		expect(wrapper.find('.menu').exists()).toBe(true);
		expect(wrapper.find('[data-action="menu"]').attributes('aria-expanded')).toBe('true');
	});

	it('carries every action the toolbar used to', async () => {
		const wrapper = await withMenuOpen();

		expect(wrapper.find('[data-action="refresh"]').exists()).toBe(true);
		expect(wrapper.find('[data-action="toggle-completed"]').exists()).toBe(true);
		expect(wrapper.find('[data-action="sign-out"]').exists()).toBe(true);
	});

	it('closes on Escape, so the keyboard is never trapped behind it', async () => {
		const wrapper = await withMenuOpen();

		await wrapper.find('.menu').trigger('keydown.esc');

		expect(wrapper.find('.menu').exists()).toBe(false);
	});

	it('closes on a click outside the panel', async () => {
		const wrapper = await withMenuOpen();

		await wrapper.find('.menu').trigger('click');

		expect(wrapper.find('.menu').exists()).toBe(false);
	});

	it('closes once an item has been chosen — the menu is not a place to live', async () => {
		const wrapper = await withMenuOpen();

		await wrapper.find('[data-action="refresh"]').trigger('click');
		await flushPromises();

		expect(wrapper.find('.menu').exists()).toBe(false);
	});

	it('reloads the list on Refresh, for when the user knows better than the app', async () => {
		const remote = fakeRemote();
		const wrapper = await withMenuOpen(remote);

		await wrapper.find('[data-action="refresh"]').trigger('click');
		await flushPromises();

		expect(remote.listAll).toHaveBeenCalled();
	});

	it('ends the session when Refresh meets an expired token', async () => {
		const listAll = vi.fn().mockRejectedValue(Object.assign(new Error('401'), { status: 401 }));
		const wrapper = await withMenuOpen(fakeRemote({ listAll }));

		await wrapper.find('[data-action="refresh"]').trigger('click');
		await flushPromises();

		expect(replaceMock).toHaveBeenCalledWith('/login');
	});

	it('toggles completed tasks, naming what the next click will do', async () => {
		const wrapper = await withMenuOpen();
		const tasks = useTasksStore();

		expect(wrapper.find('[data-action="toggle-completed"]').text()).toMatch(/show completed/i);

		await wrapper.find('[data-action="toggle-completed"]').trigger('click');

		expect(tasks.completedShown).toBe(true);

		await wrapper.find('[data-action="menu"]').trigger('click');

		expect(wrapper.find('[data-action="toggle-completed"]').text()).toMatch(/hide completed/i);
	});
});

describe('signing out', () => {
	it('offers a way out only when there is a session to leave', async () => {
		expect(mountApp().find('[data-action="menu"]').exists()).toBe(false);

		const wrapper = await withMenuOpen();

		expect(wrapper.find('[data-action="sign-out"]').exists()).toBe(true);
	});

	it('empties the task list, so the next account never sees the last one’s work', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
		const wrapper = await withMenuOpen();
		const tasks = useTasksStore();
		tasks.tasks = [{ id: '1', title: 'Private thing', notes: null, due_at: null, completed_at: null }];

		await wrapper.find('[data-action="sign-out"]').trigger('click');
		await flushPromises();

		expect(tasks.tasks).toEqual([]);
	});

	it('clears the session and returns to login even when the revoke call fails', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
		const wrapper = await withMenuOpen();

		await wrapper.find('[data-action="sign-out"]').trigger('click');
		await flushPromises();

		expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
		expect(replaceMock).toHaveBeenCalledWith('/login');
	});
});

describe('build configuration', () => {
	it('injects __APP_VERSION__ from version.json, so the app and tests agree', () => {
		const version = JSON.parse(readFileSync(join(process.cwd(), 'version.json'), 'utf8')).version;

		expect(__APP_VERSION__).toBe(version);
	});

	it('keeps every SFC free of a <style> block — CSS is central, see CLAUDE.md §5', () => {
		const offenders = vueFiles(join(process.cwd(), 'src')).filter((path) =>
			readFileSync(path, 'utf8').includes('<style'),
		);

		expect(offenders).toEqual([]);
	});

	it('depends on no CSS framework — the stylesheet is hand-written', () => {
		const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
		const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

		expect(deps.filter((name) => /tailwind|bootstrap|bulma|vuetify/i.test(name))).toEqual([]);
	});
});
