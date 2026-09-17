import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import TasksListView from '@/views/TasksListView.vue';
import { useOfflineStore, useRemote, useTasksStore } from '@/stores/tasks';
import { createOfflineStore } from '@/lib/offlineStore';
import { memoryKv } from '@/lib/kv';
import { fakeServer, failing, task } from '../support/server';

// The view listens on document and window for the tab coming back. A wrapper
// left mounted keeps listening into the next test and syncs someone else's list.
enableAutoUnmount(afterEach);

// The route is reactive, as the real one is: delete mode is read off it, so a
// test has to be able to flip it and watch the view follow.
const { pushMock, replaceMock, route } = await vi.hoisted(async () => {
	const { reactive } = await import('vue');
	return { pushMock: vi.fn(), replaceMock: vi.fn(), route: reactive({ query: {} }) };
});
vi.mock('vue-router', () => ({
	useRouter: () => ({ push: pushMock, replace: replaceMock }),
	useRoute: () => route,
	RouterLink: { template: '<a><slot /></a>' },
}));

async function mounted(remote = fakeServer(), { completedShown = false, offline = null } = {}) {
	const pinia = createPinia();
	setActivePinia(pinia);
	// A test that needs the device to outlive the component — a reload — hands
	// in a data layer it built itself over storage it keeps hold of.
	if (offline) {
		useOfflineStore(offline);
	} else {
		useRemote(remote);
	}

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
	route.query = {};
});

/** Mounted straight into delete mode, as the menu item would land it. */
async function inDeleteMode(remote = fakeServer(), options = {}) {
	route.query = { mode: 'delete' };
	return mounted(remote, options);
}

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

describe('normal mode', () => {
	it('puts no delete control on a row', async () => {
		const { wrapper } = await mounted(fakeServer([task('1')]));

		expect(wrapper.find('[data-action="delete"]').exists()).toBe(false);
		expect(wrapper.find('.actionbar').exists()).toBe(false);
	});
});

describe('delete mode', () => {
	it('marks the list itself, so the rows can drop their state colours while the mode lasts', async () => {
		const { wrapper } = await inDeleteMode(fakeServer([task('1')]));

		expect(wrapper.find('.list').classes()).toContain('is-delete-mode');
	});

	it('leaves the list unmarked in normal mode', async () => {
		const { wrapper } = await mounted(fakeServer([task('1')]));

		expect(wrapper.find('.list').classes()).not.toContain('is-delete-mode');
	});

	it('disables the tick — completing is not on offer while the mode is about deleting', async () => {
		const { wrapper } = await inDeleteMode(fakeServer([task('1')]));

		expect(wrapper.find('input[type="checkbox"]').attributes('disabled')).toBeDefined();
	});

	it('leaves the tick usable in normal mode', async () => {
		const { wrapper } = await mounted(fakeServer([task('1')]));

		expect(wrapper.find('input[type="checkbox"]').attributes('disabled')).toBeUndefined();
	});

	it('is entered from the route, and swaps the add button for an action bar', async () => {
		const { wrapper } = await inDeleteMode(fakeServer([task('1')]));

		expect(wrapper.find('.actionbar').exists()).toBe(true);
		expect(wrapper.find('[data-action="new-task"]').exists()).toBe(false);
		expect(wrapper.find('.actionbar').text()).toContain('0 selected');
		expect(wrapper.find('[data-action="delete-selected"]').attributes('disabled')).toBeDefined();
	});

	it('selects a task by clicking anywhere on its row, and says so', async () => {
		const { wrapper } = await inDeleteMode(fakeServer([task('1')]));
		const row = wrapper.find('.list__row');

		await row.trigger('click');

		expect(row.classes()).toContain('is-selected');
		expect(row.attributes('aria-selected')).toBe('true');
		expect(row.findAll('.visually-hidden').map((el) => el.text())).toContain('Selected');
		expect(wrapper.find('.actionbar').text()).toContain('1 selected');
		expect(wrapper.find('[data-action="delete-selected"]').attributes('disabled')).toBeUndefined();
	});

	it('deselects on a second click', async () => {
		const { wrapper } = await inDeleteMode(fakeServer([task('1')]));
		const row = wrapper.find('.list__row');

		await row.trigger('click');
		await row.trigger('click');

		expect(row.classes()).not.toContain('is-selected');
		expect(wrapper.find('.actionbar').text()).toContain('0 selected');
	});

	it('makes the name and the tick inert — a row click only ever selects', async () => {
		const remote = fakeServer([task('1')]);
		const { wrapper } = await inDeleteMode(remote);

		await wrapper.find('[data-action="open"]').trigger('click');
		await wrapper.find('input[type="checkbox"]').trigger('change');
		await flushPromises();

		expect(pushMock).not.toHaveBeenCalled();
		expect(remote.complete).not.toHaveBeenCalled();
		expect(wrapper.find('.list__row').classes()).toContain('is-selected');
	});

	/*
	 * A real browser never delivers this click: the tick is disabled and taken
	 * out of hit-testing, so the row answers for it. jsdom has no hit-testing,
	 * so the test dispatches it straight at the box — which is the one way the
	 * box could ever see it, and the point is that it still does not flip.
	 */
	it('leaves the tick visually where it was — a box that flips but saves nothing is a lie', async () => {
		const { wrapper } = await inDeleteMode(fakeServer([task('1')]));
		const box = wrapper.find('input[type="checkbox"]');

		await box.trigger('click');

		expect(box.element.checked).toBe(false);
		expect(wrapper.find('.list__row').classes()).not.toContain('is-selected');
	});

	it('offers completed tasks for deletion too, when they are shown', async () => {
		const { wrapper } = await inDeleteMode(
			fakeServer([task('1'), task('2', { completed_at: '2026-08-30T10:00:00.000000Z' })]),
			{ completedShown: true },
		);

		const rows = wrapper.findAll('.list__row');
		await rows[0].trigger('click');
		await rows[1].trigger('click');

		expect(wrapper.find('.actionbar').text()).toContain('2 selected');
	});

	it('asks once for the whole batch before deleting anything', async () => {
		const remote = fakeServer([task('1'), task('2'), task('3')]);
		const { wrapper } = await inDeleteMode(remote);
		const rows = wrapper.findAll('.list__row');

		await rows[0].trigger('click');
		await rows[2].trigger('click');
		await wrapper.find('[data-action="delete-selected"]').trigger('click');

		expect(wrapper.find('.modal').exists()).toBe(true);
		expect(wrapper.find('.modal').text()).toMatch(/delete 2 tasks/i);
		expect(remote.remove).not.toHaveBeenCalled();
	});

	it('speaks in the singular for one task', async () => {
		const { wrapper } = await inDeleteMode(fakeServer([task('1')]));

		await wrapper.find('.list__row').trigger('click');
		await wrapper.find('[data-action="delete-selected"]').trigger('click');

		expect(wrapper.find('.modal').text()).toMatch(/delete 1 task\?/i);
	});

	it('deletes every selected task once confirmed, and leaves the mode', async () => {
		const remote = fakeServer([task('1'), task('2'), task('3')]);
		const { wrapper } = await inDeleteMode(remote);
		const rows = wrapper.findAll('.list__row');

		await rows[0].trigger('click');
		await rows[2].trigger('click');
		await wrapper.find('[data-action="delete-selected"]').trigger('click');
		await wrapper.find('[data-action="confirm"]').trigger('click');
		await flushPromises();

		expect(remote.remove).toHaveBeenCalledTimes(2);
		expect(remote.remove).toHaveBeenCalledWith('1');
		expect(remote.remove).toHaveBeenCalledWith('3');
		expect(wrapper.findAll('.list__row')).toHaveLength(1);
		expect(replaceMock).toHaveBeenCalledWith({ query: {} });
	});

	it('leaves everything alone when the dialog is cancelled', async () => {
		const remote = fakeServer([task('1')]);
		const { wrapper } = await inDeleteMode(remote);

		await wrapper.find('.list__row').trigger('click');
		await wrapper.find('[data-action="delete-selected"]').trigger('click');
		await wrapper.find('.modal').trigger('keydown', { key: 'Escape' });
		await flushPromises();

		expect(remote.remove).not.toHaveBeenCalled();
		expect(wrapper.findAll('.list__row')).toHaveLength(1);
		expect(wrapper.find('.list__row').classes()).toContain('is-selected');
	});

	it('cancels the mode itself from the bar, deleting nothing', async () => {
		const remote = fakeServer([task('1')]);
		const { wrapper } = await inDeleteMode(remote);

		await wrapper.find('.list__row').trigger('click');
		await wrapper.find('[data-action="cancel-delete"]').trigger('click');

		expect(remote.remove).not.toHaveBeenCalled();
		expect(replaceMock).toHaveBeenCalledWith({ query: {} });
	});

	it('cancels on Escape from the list', async () => {
		const { wrapper } = await inDeleteMode(fakeServer([task('1')]));

		await wrapper.find('.list__row').trigger('click');
		await wrapper.trigger('keydown', { key: 'Escape' });

		expect(replaceMock).toHaveBeenCalledWith({ query: {} });
	});

	it('forgets the selection and brings the add button back once the route leaves the mode', async () => {
		const { wrapper } = await inDeleteMode(fakeServer([task('1')]));
		await wrapper.find('.list__row').trigger('click');

		route.query = {};
		await wrapper.vm.$nextTick();

		expect(wrapper.find('.actionbar').exists()).toBe(false);
		expect(wrapper.find('[data-action="new-task"]').exists()).toBe(true);
		expect(wrapper.find('.list__row').classes()).not.toContain('is-selected');

		route.query = { mode: 'delete' };
		await wrapper.vm.$nextTick();

		expect(wrapper.find('.actionbar').text()).toContain('0 selected');
	});

	it('treats a task the server has already lost as deleted rather than reporting a 404', async () => {
		const remote = fakeServer([task('1'), task('2')]);
		const { wrapper } = await inDeleteMode(remote);

		remote.records.delete('1');
		const realRemove = remote.remove;
		remote.remove = vi.fn(async (id) => (id === '1' ? failing(404)() : realRemove(id)));

		const rows = wrapper.findAll('.list__row');
		await rows[0].trigger('click');
		await rows[1].trigger('click');
		await wrapper.find('[data-action="delete-selected"]').trigger('click');
		await wrapper.find('[data-action="confirm"]').trigger('click');
		await flushPromises();

		expect(wrapper.findAll('.list__row')).toHaveLength(0);
		expect(wrapper.find('.error').exists()).toBe(false);
		expect(remote.remove).toHaveBeenCalledWith('2');
	});

	it('deletes the batch with no connection and does not put the rows back', async () => {
		const remote = fakeServer([task('1'), task('2')]);
		const { wrapper, store } = await inDeleteMode(remote);
		unplug(remote);

		const rows = wrapper.findAll('.list__row');
		await rows[0].trigger('click');
		await rows[1].trigger('click');
		await wrapper.find('[data-action="delete-selected"]').trigger('click');
		await wrapper.find('[data-action="confirm"]').trigger('click');
		await flushPromises();

		expect(wrapper.findAll('.list__row')).toHaveLength(0);
		expect(wrapper.find('.error').exists()).toBe(false);
		expect(store.pendingCount).toBe(2);
	});

	it('keeps the queued batch across a reload', async () => {
		const remote = fakeServer([task('1'), task('2')]);
		const kv = memoryKv();
		const outboxKv = memoryKv();
		const offline = createOfflineStore({ kv, outboxKv, remote });
		const { wrapper } = await inDeleteMode(remote, { offline });
		unplug(remote);

		const rows = wrapper.findAll('.list__row');
		await rows[0].trigger('click');
		await rows[1].trigger('click');
		await wrapper.find('[data-action="delete-selected"]').trigger('click');
		await wrapper.find('[data-action="confirm"]').trigger('click');
		await flushPromises();
		wrapper.unmount();

		const { store } = await mounted(remote, { offline: createOfflineStore({ kv, outboxKv, remote }) });

		expect(store.pendingCount).toBe(2);
		expect(store.tasks).toEqual([]);
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
