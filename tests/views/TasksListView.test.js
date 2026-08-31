import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import TasksListView from '@/views/TasksListView.vue';
import { useRemote, useTasksStore } from '@/stores/tasks';

// The view listens on document and window for the tab coming back. A wrapper
// left mounted keeps listening into the next test and reloads someone else's
// list.
enableAutoUnmount(afterEach);

const { pushMock, replaceMock } = vi.hoisted(() => ({ pushMock: vi.fn(), replaceMock: vi.fn() }));
vi.mock('vue-router', () => ({
	useRouter: () => ({ push: pushMock, replace: replaceMock }),
	useRoute: () => ({ query: {} }),
	RouterLink: { template: '<a><slot /></a>' },
}));

const task = (id, over = {}) => ({
	id,
	title: `Task ${id}`,
	notes: null,
	due_at: null,
	completed_at: null,
	...over,
});

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

function mountView(remote = fakeRemote()) {
	const pinia = createPinia();
	setActivePinia(pinia);
	useRemote(remote);

	return mount(TasksListView, {
		global: { plugins: [pinia], stubs: { RouterLink: true } },
	});
}

async function mounted(remote) {
	const wrapper = mountView(remote);
	await flushPromises();

	return wrapper;
}

const failure = (status) => Object.assign(new Error(`Request failed (${status}).`), { status });

// Fixed so "today" and "overdue" mean the same thing on every machine.
const NOW = new Date(2026, 7, 30, 12, 0);

beforeEach(() => {
	localStorage.clear();
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
	pushMock.mockClear();
	replaceMock.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('loading the list', () => {
	it('asks the server for the tasks on mount', async () => {
		const remote = fakeRemote();

		await mounted(remote);

		expect(remote.listAll).toHaveBeenCalledOnce();
	});

	it('shows a loading state until the tasks arrive', async () => {
		const wrapper = mountView();

		expect(wrapper.text()).toMatch(/loading/i);

		await flushPromises();

		expect(wrapper.text()).not.toMatch(/loading/i);
	});

	it('invites the user to add something when there are no tasks', async () => {
		const wrapper = await mounted();

		expect(wrapper.text()).toMatch(/no tasks/i);
	});
});

describe('one flat list', () => {
	// Built per test: vi.restoreAllMocks() between tests would strip the
	// implementation off a fake shared at describe scope.
	const spread = () =>
		fakeRemote({
			listAll: vi.fn().mockResolvedValue([
				task('undated'),
				task('upcoming', { due_at: '2026-09-05' }),
				task('today', { due_at: '2026-08-30' }),
				task('overdue', { due_at: '2026-08-20' }),
			]),
		});

	it('renders no group headings — the colour of a row says what a heading used to', async () => {
		const wrapper = await mounted(spread());

		expect(wrapper.findAll('.list__header')).toHaveLength(0);
		expect(wrapper.findAll('.list')).toHaveLength(1);
	});

	it('orders soonest due first and undated last, across every state', async () => {
		const wrapper = await mounted(spread());

		expect(wrapper.findAll('.list__row').map((row) => row.text())).toEqual([
			expect.stringContaining('Task overdue'),
			expect.stringContaining('Task today'),
			expect.stringContaining('Task upcoming'),
			expect.stringContaining('Task undated'),
		]);
	});

	it('leaves completed tasks out until they are asked for', async () => {
		const wrapper = await mounted(
			fakeRemote({
				listAll: vi
					.fn()
					.mockResolvedValue([task('done', { completed_at: '2026-08-30T10:00:00.000000Z' })]),
			}),
		);

		expect(wrapper.findAll('.list__row')).toHaveLength(0);
	});

	it('mixes completed tasks into the same list when they are, not into a section', async () => {
		const wrapper = await mounted(
			fakeRemote({
				listAll: vi.fn().mockResolvedValue([
					task('open', { due_at: '2026-09-05' }),
					task('done', { due_at: '2026-09-01', completed_at: '2026-08-30T10:00:00.000000Z' }),
				]),
			}),
		);
		useTasksStore().completedShown = true;
		await flushPromises();

		expect(wrapper.findAll('[data-section="completed"]')).toHaveLength(0);
		expect(wrapper.findAll('.list__row').map((row) => row.text())).toEqual([
			expect.stringContaining('Task done'),
			expect.stringContaining('Task open'),
		]);
	});
});

describe('a row', () => {
	const one = (over) => fakeRemote({ listAll: vi.fn().mockResolvedValue([task('1', over)]) });

	it('shows the task title', async () => {
		const wrapper = await mounted(one({ title: 'Buy milk' }));

		expect(wrapper.find('.list__primary').text()).toContain('Buy milk');
	});

	it('carries a tick box, the name and a delete control — and nothing else', async () => {
		const wrapper = await mounted(one({ due_at: '2026-09-05', notes: 'Some notes' }));
		const row = wrapper.find('.list__row');

		expect(row.find('input[type="checkbox"]').exists()).toBe(true);
		expect(row.find('[data-action="open"]').exists()).toBe(true);
		expect(row.find('[data-action="delete"]').exists()).toBe(true);
		expect(row.findAll('button')).toHaveLength(2);
	});

	it('shows no due date, no badge and no note indicator — the row is the name', async () => {
		const wrapper = await mounted(one({ due_at: '2026-09-05', notes: 'Some notes' }));
		const row = wrapper.find('.list__row');

		expect(row.find('.list__secondary').exists()).toBe(false);
		expect(row.find('.badge').exists()).toBe(false);
		expect(row.find('[data-role="has-notes"]').exists()).toBe(false);
		expect(row.text()).not.toMatch(/5 Sep|Sep 5|05 Sep/i);
	});

	it('opens the task form when the name is clicked', async () => {
		const wrapper = await mounted(one({ title: 'Buy milk' }));

		await wrapper.find('[data-action="open"]').trigger('click');

		expect(pushMock).toHaveBeenCalledWith('/tasks/1/edit');
	});

	it('offers the name as a real button, so it is reachable without a mouse', async () => {
		const wrapper = await mounted(one({ title: 'Buy milk' }));

		expect(wrapper.find('[data-action="open"]').element.tagName).toBe('BUTTON');
	});
});

describe('the colour a row carries', () => {
	const one = (over) => fakeRemote({ listAll: vi.fn().mockResolvedValue([task('1', over)]) });

	const rowFor = async (over) => (await mounted(one(over))).find('.list__row');

	it('marks an overdue task', async () => {
		expect((await rowFor({ due_at: '2026-08-20' })).classes()).toContain('list__row--overdue');
	});

	it('marks a task due today', async () => {
		expect((await rowFor({ due_at: '2026-08-30' })).classes()).toContain('list__row--today');
	});

	it('marks a task due later', async () => {
		expect((await rowFor({ due_at: '2026-09-05' })).classes()).toContain('list__row--upcoming');
	});

	it('marks a task with no due date', async () => {
		expect((await rowFor({})).classes()).toContain('list__row--undated');
	});

	it('marks a completed task, whatever its due date was', async () => {
		const wrapper = await mounted(
			one({ due_at: '2026-08-20', completed_at: '2026-08-29T10:00:00.000000Z' }),
		);
		useTasksStore().completedShown = true;
		await flushPromises();

		expect(wrapper.find('.list__row').classes()).toContain('list__row--completed');
	});

	it('names the state in text for anyone who cannot see the colour', async () => {
		const row = await rowFor({ due_at: '2026-08-20' });

		// The badges are gone, so this is the only thing left carrying the state.
		// Colour alone would leave a screen reader with nothing at all.
		expect(row.find('.visually-hidden').text()).toMatch(/overdue/i);
	});
});

describe('keeping the list current without being asked', () => {
	it('reloads when the tab is looked at again', async () => {
		const remote = fakeRemote();
		await mounted(remote);

		document.dispatchEvent(new Event('visibilitychange'));
		await flushPromises();

		expect(remote.listAll).toHaveBeenCalledTimes(2);
	});

	it('reloads when the window is focused again', async () => {
		const remote = fakeRemote();
		await mounted(remote);
		// Far enough past the mount load that it is not treated as the same visit.
		vi.setSystemTime(new Date(NOW.getTime() + 60_000));

		window.dispatchEvent(new Event('focus'));
		await flushPromises();

		expect(remote.listAll).toHaveBeenCalledTimes(2);
	});

	it('does not reload twice when a tab switch fires both signals at once', async () => {
		const remote = fakeRemote();
		await mounted(remote);

		document.dispatchEvent(new Event('visibilitychange'));
		window.dispatchEvent(new Event('focus'));
		await flushPromises();

		expect(remote.listAll).toHaveBeenCalledTimes(2);
	});

	it('polls nothing — a user working alone has nothing to race with', async () => {
		const remote = fakeRemote();
		await mounted(remote);

		vi.advanceTimersByTime(10 * 60 * 1000);
		await flushPromises();

		expect(remote.listAll).toHaveBeenCalledOnce();
	});

	it('stops listening once the view is gone', async () => {
		const remote = fakeRemote();
		const wrapper = await mounted(remote);

		wrapper.unmount();
		document.dispatchEvent(new Event('visibilitychange'));
		await flushPromises();

		expect(remote.listAll).toHaveBeenCalledOnce();
	});
});

describe('when the server cannot be reached', () => {
	it('says so without blaming the user, and stops loading', async () => {
		const wrapper = await mounted(
			fakeRemote({ listAll: vi.fn().mockRejectedValue(failure(500)) }),
		);

		expect(wrapper.find('.error').exists()).toBe(true);
		expect(wrapper.text()).not.toMatch(/loading/i);
	});

	it('keeps showing the tasks it already had', async () => {
		const listAll = vi
			.fn()
			.mockResolvedValueOnce([task('1', { title: 'Buy milk' })])
			.mockRejectedValueOnce(failure(500));
		const remote = fakeRemote({ listAll });
		const wrapper = await mounted(remote);

		document.dispatchEvent(new Event('visibilitychange'));
		await flushPromises();

		expect(wrapper.find('.error').exists()).toBe(true);
		expect(wrapper.text()).toContain('Buy milk');
	});

	it('returns to login when the session has expired', async () => {
		await mounted(fakeRemote({ listAll: vi.fn().mockRejectedValue(failure(401)) }));

		expect(replaceMock).toHaveBeenCalledWith('/login');
	});

	it('does not claim the account is empty when the first load never arrived', async () => {
		const wrapper = await mounted(
			fakeRemote({ listAll: vi.fn().mockRejectedValue(failure(500)) }),
		);

		// "No tasks yet" alongside "could not reach the server" tells the user
		// two contradictory things, one of which is a guess.
		expect(wrapper.find('.error').exists()).toBe(true);
		expect(wrapper.text()).not.toMatch(/no tasks yet/i);
	});
});

describe('an account whose tasks are all completed', () => {
	it('says the open list is clear rather than claiming there are no tasks at all', async () => {
		const wrapper = await mounted(
			fakeRemote({
				listAll: vi
					.fn()
					.mockResolvedValue([task('done', { completed_at: '2026-08-30T10:00:00.000000Z' })]),
			}),
		);

		expect(wrapper.text()).not.toMatch(/no tasks yet/i);
		expect(wrapper.text()).toMatch(/nothing open/i);
	});
});

describe('a task due today', () => {
	it('is not called overdue while its day is still running', async () => {
		const wrapper = await mounted(
			fakeRemote({ listAll: vi.fn().mockResolvedValue([task('1', { due_at: '2026-08-30' })]) }),
		);

		const row = wrapper.find('.list__row');

		expect(row.classes()).toContain('list__row--today');
		expect(row.text()).not.toMatch(/overdue/i);
	});
});

describe('reusing the shared stylesheet', () => {
	it('builds the list from the shared classes rather than minting its own', async () => {
		const wrapper = await mounted(
			fakeRemote({ listAll: vi.fn().mockResolvedValue([task('1', { due_at: '2026-09-05' })]) }),
		);

		expect(wrapper.find('.list').exists()).toBe(true);
		expect(wrapper.find('.list__row').exists()).toBe(true);
		expect(wrapper.find('[class*="task-"]').exists()).toBe(false);
	});
});
