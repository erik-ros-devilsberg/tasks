import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import App from '@/App.vue';
import { TOKEN_KEY } from '@/stores/session';
import { useRemote, useTasksStore } from '@/stores/tasks';
import { fakeServer, failing, task } from './support/server';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));
vi.mock('vue-router', () => ({
	useRouter: () => ({ replace: replaceMock }),
	RouterView: { template: '<div />' },
	RouterLink: { template: '<a><slot /></a>' },
}));

/** The browser's own view of the connection, which `useOnline` reads. */
function setOnline(value) {
	Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

function mountApp(remote = fakeServer()) {
	const pinia = createPinia();
	setActivePinia(pinia);
	useRemote(remote);

	return mount(App, {
		attachTo: document.body,
		global: { plugins: [pinia], stubs: { RouterView: true, RouterLink: true } },
	});
}

/** Signed in, with the menu already open — the state most of these start from. */
async function withMenuOpen(remote = fakeServer()) {
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
	setOnline(true);
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

		expect(wrapper.find('[data-action="sync"]').exists()).toBe(true);
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

		await wrapper.find('[data-action="sync"]').trigger('click');
		await flushPromises();

		expect(wrapper.find('.menu').exists()).toBe(false);
	});

	it('syncs on demand, for when the user knows better than the app', async () => {
		const remote = fakeServer();
		const wrapper = await withMenuOpen(remote);

		await wrapper.find('[data-action="sync"]').trigger('click');
		await flushPromises();

		expect(remote.listAll).toHaveBeenCalled();
	});

	it('says how much work is still waiting, so "sync now" is not a guess', async () => {
		const wrapper = await withMenuOpen();
		const tasks = useTasksStore();

		await tasks.create({ title: 'Buy milk', notes: null, due_at: null, duration: null });
		await wrapper.vm.$nextTick();

		expect(wrapper.find('[data-action="sync"]').text()).toContain('1');
	});
});

describe('when a sync finds the session gone', () => {
	it('returns to login rather than leaving a screen that still looks signed in', async () => {
		// Handled in the shell, not per view: any view can be on screen when a
		// background sync meets an expired token.
		const remote = fakeServer();
		remote.listAll = failing(401);

		const wrapper = await withMenuOpen(remote);

		await wrapper.find('[data-action="sync"]').trigger('click');
		await flushPromises();

		expect(replaceMock).toHaveBeenCalledWith('/login');
	});

	it('empties the device on the way out — the tasks belong to that account', async () => {
		const remote = fakeServer([task('1', { title: 'Private thing' })]);
		const wrapper = await withMenuOpen(remote);
		const tasks = useTasksStore();

		await tasks.syncNow();
		expect(tasks.tasks).toHaveLength(1);

		remote.listAll = failing(401);
		await wrapper.find('[data-action="sync"]').trigger('click');
		await flushPromises();

		expect(tasks.tasks).toEqual([]);
	});
});

describe('the connection strip', () => {
	it('says the app is offline, in the voice of a fact rather than a failure', async () => {
		setOnline(false);
		localStorage.setItem(TOKEN_KEY, 'a-token');

		const wrapper = mountApp();

		expect(wrapper.find('[data-state="offline"]').exists()).toBe(true);
		expect(wrapper.find('.conn--offline').text()).toMatch(/saved here/i);
	});

	it('counts the changes that have not reached the server yet', async () => {
		localStorage.setItem(TOKEN_KEY, 'a-token');
		const wrapper = mountApp();
		const tasks = useTasksStore();

		await tasks.create({ title: 'Buy milk', notes: null, due_at: null, duration: null });
		await wrapper.vm.$nextTick();

		expect(wrapper.find('[data-state="pending"]').text()).toMatch(/1 change waiting/i);
	});

	it('says nothing at all when everything is synced', async () => {
		localStorage.setItem(TOKEN_KEY, 'a-token');

		const wrapper = mountApp();

		expect(wrapper.find('.conn').exists()).toBe(false);
	});

	it('stays out of the way of someone who is not signed in', () => {
		setOnline(false);

		expect(mountApp().find('.conn').exists()).toBe(false);
	});
});

describe('a new version', () => {
	it('offers a reload rather than taking the page out from under the user', async () => {
		const wrapper = mountApp();

		expect(wrapper.find('[data-action="reload"]').exists()).toBe(false);

		window.dispatchEvent(new CustomEvent('app-update-ready'));
		await wrapper.vm.$nextTick();

		expect(wrapper.find('[data-action="reload"]').exists()).toBe(true);
	});
});

describe('the completed-tasks toggle', () => {
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
