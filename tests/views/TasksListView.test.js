import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import TasksListView from '@/views/TasksListView.vue';
import { useRemote } from '@/stores/tasks';

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

describe('grouping', () => {
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

	it('renders the groups in order: overdue, today, upcoming, undated', async () => {
		const wrapper = await mounted(spread());

		const headers = wrapper.findAll('.list__header').map((h) => h.text());

		expect(headers).toEqual(['Overdue', 'Today', 'Upcoming', 'No due date']);
	});

	it('omits a group with nothing in it rather than rendering an empty heading', async () => {
		const wrapper = await mounted(
			fakeRemote({ listAll: vi.fn().mockResolvedValue([task('1', { due_at: '2026-09-05' })]) }),
		);

		expect(wrapper.findAll('.list__header').map((h) => h.text())).toEqual(['Upcoming']);
	});

	it('leaves completed tasks out of the open list', async () => {
		const wrapper = await mounted(
			fakeRemote({
				listAll: vi
					.fn()
					.mockResolvedValue([task('done', { completed_at: '2026-08-30T10:00:00.000000Z' })]),
			}),
		);

		expect(wrapper.findAll('.list__row')).toHaveLength(0);
	});
});

describe('a row', () => {
	it('shows the task title', async () => {
		const wrapper = await mounted(
			fakeRemote({ listAll: vi.fn().mockResolvedValue([task('1', { title: 'Buy milk' })]) }),
		);

		expect(wrapper.find('.list__primary').text()).toContain('Buy milk');
	});

	it('shows a date-only due date without inventing a time for it', async () => {
		const wrapper = await mounted(
			fakeRemote({ listAll: vi.fn().mockResolvedValue([task('1', { due_at: '2026-09-05' })]) }),
		);

		const text = wrapper.find('.list__secondary').text();

		expect(text).toMatch(/5 Sep|Sep 5|05 Sep/i);
		expect(text).not.toMatch(/\d{2}:\d{2}/);
	});

	it('shows the time on a datetime due date, so the two granularities are distinguishable', async () => {
		const wrapper = await mounted(
			fakeRemote({
				listAll: vi.fn().mockResolvedValue([task('1', { due_at: '2026-09-05T14:30:00.000000Z' })]),
			}),
		);

		expect(wrapper.find('.list__secondary').text()).toMatch(/14:30/);
	});

	it('marks an overdue row with text, not colour alone', async () => {
		const wrapper = await mounted(
			fakeRemote({ listAll: vi.fn().mockResolvedValue([task('1', { due_at: '2026-08-20' })]) }),
		);

		const row = wrapper.find('.list__row');

		expect(row.classes()).toContain('is-overdue');
		expect(row.text()).toMatch(/overdue/i);
	});

	it('indicates a task carries notes without spilling them into the list', async () => {
		const notes = 'A very long note '.repeat(50);
		const wrapper = await mounted(
			fakeRemote({ listAll: vi.fn().mockResolvedValue([task('1', { notes })]) }),
		);

		const row = wrapper.find('.list__row');

		expect(row.find('[data-role="has-notes"]').exists()).toBe(true);
		expect(row.text()).not.toContain(notes);
	});

	it('shows no note indicator when there are none', async () => {
		const wrapper = await mounted(fakeRemote({ listAll: vi.fn().mockResolvedValue([task('1')]) }));

		expect(wrapper.find('[data-role="has-notes"]').exists()).toBe(false);
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

		await wrapper.find('[data-action="refresh"]').trigger('click');
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

describe('the overdue marker and the heading agree', () => {
	it('never badges a row as overdue while it sits under Today', async () => {
		const wrapper = await mounted(
			fakeRemote({ listAll: vi.fn().mockResolvedValue([task('1', { due_at: '2026-08-30' })]) }),
		);

		expect(wrapper.find('.list__header').text()).toBe('Today');
		expect(wrapper.find('.list__row').text()).not.toMatch(/overdue/i);
		expect(wrapper.find('.list__row').classes()).not.toContain('is-overdue');
	});
});

describe('reusing the shared stylesheet', () => {
	it('builds the list from the shared classes rather than minting its own', async () => {
		const wrapper = await mounted(
			fakeRemote({ listAll: vi.fn().mockResolvedValue([task('1', { due_at: '2026-09-05' })]) }),
		);

		expect(wrapper.find('.list').exists()).toBe(true);
		expect(wrapper.find('.list__header').exists()).toBe(true);
		expect(wrapper.find('.list__row').exists()).toBe(true);
		expect(wrapper.find('[class*="task-"]').exists()).toBe(false);
	});
});
