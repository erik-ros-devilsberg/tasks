import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import App from '@/App.vue';
import { TOKEN_KEY } from '@/stores/session';
import { useTasksStore } from '@/stores/tasks';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));
vi.mock('vue-router', () => ({
	useRouter: () => ({ replace: replaceMock }),
	RouterView: { template: '<div />' },
	RouterLink: { template: '<a><slot /></a>' },
}));

function mountApp() {
	const pinia = createPinia();
	setActivePinia(pinia);

	return mount(App, {
		global: { plugins: [pinia], stubs: { RouterView: true, RouterLink: true } },
	});
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

	it('shows the build version, so a user can report which one they are on', () => {
		const wrapper = mountApp();

		expect(wrapper.text()).toContain(__APP_VERSION__);
	});
});

describe('signing out', () => {
	it('offers a way out only when there is a session to leave', () => {
		expect(mountApp().find('[data-action="sign-out"]').exists()).toBe(false);

		localStorage.setItem(TOKEN_KEY, 'a-token');

		expect(mountApp().find('[data-action="sign-out"]').exists()).toBe(true);
	});

	it('empties the task list, so the next account never sees the last one’s work', async () => {
		localStorage.setItem(TOKEN_KEY, 'a-token');
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
		const wrapper = mountApp();
		const tasks = useTasksStore();
		tasks.tasks = [{ id: '1', title: 'Private thing', notes: null, due_at: null, completed_at: null }];

		await wrapper.find('[data-action="sign-out"]').trigger('click');
		await flushPromises();

		expect(tasks.tasks).toEqual([]);
	});

	it('clears the session and returns to login even when the revoke call fails', async () => {
		localStorage.setItem(TOKEN_KEY, 'a-token');
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
		const wrapper = mountApp();

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
