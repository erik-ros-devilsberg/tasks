import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import TasksListView from '@/views/TasksListView.vue';
import { useRemote, useTasksStore } from '@/stores/tasks';
import { fakeServer, failing, task } from '../support/server';

// The view listens on document and window for the tab coming back. A wrapper
// left mounted keeps listening into the next test and syncs someone else's list.
enableAutoUnmount(afterEach);

const { pushMock, replaceMock } = vi.hoisted(() => ({ pushMock: vi.fn(), replaceMock: vi.fn() }));
vi.mock('vue-router', () => ({
	useRouter: () => ({ push: pushMock, replace: replaceMock }),
	useRoute: () => ({ query: {} }),
	RouterLink: { template: '<a><slot /></a>' },
}));

async function mounted(remote = fakeServer(), { completedShown = false } = {}) {
	const pinia = createPinia();
	setActivePinia(pinia);
	useRemote(remote);

	const store = useTasksStore();
	store.completedShown = completedShown;

	const wrapper = mount(TasksListView, {
		global: { plugins: [pinia], stubs: { RouterLink: true } },
	});
	await flushPromises();

	return { wrapper, remote, store };
}

/** Takes the connection away from an already-synced app. */
function unplug(remote) {
	remote.listAll = failing(0);
	remote.complete = failing(0);
	remote.reopen = failing(0);
	remote.update = failing(0);
	remote.remove = failing(0);
	remote.create = failing(0);
}

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

describe('completing a task', () => {
	it('offers a checkbox naming the task, not an unlabelled box', async () => {
		const { wrapper } = await mounted(fakeServer([task('1', { title: 'Buy milk' })]));

		const box = wrapper.find('input[type="checkbox"]');

		expect(box.exists()).toBe(true);
		expect(box.attributes('aria-label')).toContain('Buy milk');
	});

	it('completes through the dedicated endpoint and drops the row from the open list', async () => {
		const { wrapper, remote } = await mounted(fakeServer([task('1')]));

		await wrapper.find('input[type="checkbox"]').setValue(true);
		await flushPromises();

		expect(remote.complete).toHaveBeenCalledWith('1');
		expect(wrapper.findAll('.list__row')).toHaveLength(0);
	});

	it('is safe to click twice — the endpoint is idempotent and the row is already gone', async () => {
		const { wrapper, remote } = await mounted(fakeServer([task('1')]));

		const box = wrapper.find('input[type="checkbox"]');
		await box.setValue(true);
		await box.setValue(true);
		await flushPromises();

		expect(remote.complete).toHaveBeenCalledTimes(1);
	});

	it('completes a task whose record omits completed_at entirely', async () => {
		const withoutKey = task('1');
		delete withoutKey.completed_at;

		const { wrapper, remote } = await mounted(fakeServer([withoutKey]));

		await wrapper.find('input[type="checkbox"]').setValue(true);
		await flushPromises();

		// A missing key means open. Reading it as "not null" would send a reopen
		// on an already-open task — a no-op instead of the completion asked for.
		expect(remote.complete).toHaveBeenCalledWith('1');
		expect(remote.reopen).not.toHaveBeenCalled();
	});

	it('completes with no connection and keeps the task marked done', async () => {
		// The change is saved. The box must not spring back — that would tell the
		// user their click did nothing, when in fact it is queued.
		const remote = fakeServer([task('1')]);
		const { wrapper, store } = await mounted(remote);
		unplug(remote);

		await wrapper.find('input[type="checkbox"]').setValue(true);
		await flushPromises();

		expect(store.tasks[0].completed_at).not.toBeNull();
		expect(wrapper.find('.error').exists()).toBe(false);
	});

	it('sends the queued completion once the connection returns', async () => {
		const remote = fakeServer([task('1')]);
		const { wrapper, store } = await mounted(remote);
		const { complete } = remote;
		unplug(remote);

		await wrapper.find('input[type="checkbox"]').setValue(true);
		await flushPromises();

		expect(store.pendingCount).toBe(1);

		remote.complete = complete;
		remote.listAll = vi.fn(async () => [...remote.records.values()]);
		await store.syncNow();

		expect(complete).toHaveBeenCalledWith('1');
		expect(store.pendingCount).toBe(0);
	});

	it('marks a row whose change has not reached the server yet', async () => {
		const remote = fakeServer([task('1')]);
		const { wrapper, store } = await mounted(remote, { completedShown: true });
		unplug(remote);

		await wrapper.find('input[type="checkbox"]').setValue(true);
		await flushPromises();

		expect(store.isPending('1')).toBe(true);
		expect(wrapper.find('[data-state="pending"]').exists()).toBe(true);
	});
});

describe('completed tasks in the list', () => {
	const withCompleted = () =>
		fakeServer([
			task('open', { due_at: '2026-09-05' }),
			task('old', { due_at: '2026-08-01', completed_at: '2026-08-01T10:00:00.000000Z' }),
			task('new', { due_at: '2026-09-01', completed_at: '2026-08-30T10:00:00.000000Z' }),
		]);

	it('are hidden until asked for', async () => {
		const { wrapper } = await mounted(withCompleted());

		expect(wrapper.findAll('.list__row')).toHaveLength(1);
	});

	it('join the one list in the same order as everything else', async () => {
		const { wrapper } = await mounted(withCompleted(), { completedShown: true });

		// Ordered by due date like any other row — being done does not move a
		// task to the bottom of the page.
		expect(wrapper.findAll('.list__row').map((row) => row.text())).toEqual([
			expect.stringContaining('Task old'),
			expect.stringContaining('Task new'),
			expect.stringContaining('Task open'),
		]);
	});

	it('come ticked, and say so without a badge', async () => {
		const { wrapper } = await mounted(withCompleted(), { completedShown: true });
		const row = wrapper.findAll('.list__row')[0];

		expect(row.find('input[type="checkbox"]').element.checked).toBe(true);
		expect(row.find('.badge').exists()).toBe(false);
		expect(row.classes()).toContain('list__row--completed');
	});

	it('name the box for reopening, not for completing again', async () => {
		const { wrapper } = await mounted(withCompleted(), { completedShown: true });

		expect(
			wrapper.findAll('.list__row')[0].find('input[type="checkbox"]').attributes('aria-label'),
		).toMatch(/reopen/i);
	});

	it('reopen from the same box that completed them', async () => {
		const { wrapper, remote } = await mounted(withCompleted(), { completedShown: true });

		await wrapper.findAll('.list__row')[0].find('input[type="checkbox"]').setValue(false);
		await flushPromises();

		expect(remote.reopen).toHaveBeenCalledWith('old');
	});

	it('leave the list saying nothing is open when every task is done', async () => {
		const { wrapper } = await mounted(
			fakeServer([task('1', { completed_at: '2026-08-30T10:00:00.000000Z' })]),
		);

		expect(wrapper.text()).toMatch(/nothing open/i);
	});
});

describe('deleting from the list', () => {
	it('asks before deleting, naming the task', async () => {
		const { wrapper, remote } = await mounted(fakeServer([task('1', { title: 'Buy milk' })]));

		await wrapper.find('[data-action="delete"]').trigger('click');

		expect(wrapper.find('.modal').exists()).toBe(true);
		expect(wrapper.find('.modal').text()).toContain('Buy milk');
		expect(remote.remove).not.toHaveBeenCalled();
	});

	it('deletes once confirmed', async () => {
		const { wrapper, remote } = await mounted(fakeServer([task('1')]));

		await wrapper.find('[data-action="delete"]').trigger('click');
		await wrapper.find('[data-action="confirm"]').trigger('click');
		await flushPromises();

		expect(remote.remove).toHaveBeenCalledWith('1');
		expect(wrapper.findAll('.list__row')).toHaveLength(0);
	});

	it('leaves the task alone when the dialog is cancelled', async () => {
		const { wrapper, remote } = await mounted(fakeServer([task('1')]));

		await wrapper.find('[data-action="delete"]').trigger('click');
		await wrapper.find('.modal').trigger('keydown', { key: 'Escape' });
		await flushPromises();

		expect(remote.remove).not.toHaveBeenCalled();
		expect(wrapper.findAll('.list__row')).toHaveLength(1);
	});

	it('treats a task the server has already lost as deleted rather than reporting a 404', async () => {
		const remote = fakeServer([task('1')]);
		const { wrapper } = await mounted(remote);

		remote.records.delete('1');
		remote.remove = failing(404);

		await wrapper.find('[data-action="delete"]').trigger('click');
		await wrapper.find('[data-action="confirm"]').trigger('click');
		await flushPromises();

		expect(wrapper.findAll('.list__row')).toHaveLength(0);
		expect(wrapper.find('.error').exists()).toBe(false);
	});

	it('deletes with no connection and does not put the row back', async () => {
		const remote = fakeServer([task('1')]);
		const { wrapper } = await mounted(remote);
		unplug(remote);

		await wrapper.find('[data-action="delete"]').trigger('click');
		await wrapper.find('[data-action="confirm"]').trigger('click');
		await flushPromises();

		expect(wrapper.findAll('.list__row')).toHaveLength(0);
		expect(wrapper.find('.error').exists()).toBe(false);
	});
});

describe('getting to the form', () => {
	it('offers a way to add a task', async () => {
		const { wrapper } = await mounted();

		expect(wrapper.find('[data-action="new-task"]').exists()).toBe(true);
	});

	it('keeps the add control within thumb reach rather than at the top of the page', async () => {
		const { wrapper } = await mounted();

		expect(wrapper.find('[data-action="new-task"]').classes()).toContain('btn--fab');
	});

	it('names the add control even though it is drawn as a plus', async () => {
		const { wrapper } = await mounted();

		expect(wrapper.find('[data-action="new-task"]').attributes('aria-label')).toMatch(/new task/i);
	});

	it('opens a task by its name — there is no separate edit control any more', async () => {
		const { wrapper } = await mounted(fakeServer([task('1')]));

		expect(wrapper.find('[data-action="edit"]').exists()).toBe(false);

		await wrapper.find('[data-action="open"]').trigger('click');

		expect(pushMock).toHaveBeenCalledWith('/tasks/1/edit');
	});
});
