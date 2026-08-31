import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import TasksListView from '@/views/TasksListView.vue';
import { useRemote } from '@/stores/tasks';
import { COMPLETED_SHOWN_KEY } from '@/composables/useCompletedShown';

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
		complete: vi.fn((id) => Promise.resolve(task(id, { completed_at: '2026-08-30T10:00:00.000000Z' }))),
		reopen: vi.fn((id) => Promise.resolve(task(id))),
		remove: vi.fn().mockResolvedValue(null),
		...over,
	};
}

async function mounted(remote = fakeRemote()) {
	const pinia = createPinia();
	setActivePinia(pinia);
	useRemote(remote);

	const wrapper = mount(TasksListView, {
		global: { plugins: [pinia], stubs: { RouterLink: true } },
	});
	await flushPromises();

	return { wrapper, remote };
}

const listing = (ids) => fakeRemote({ listAll: vi.fn().mockResolvedValue(ids) });

const failure = (status) => Object.assign(new Error(`Request failed (${status}).`), { status });

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
		const { wrapper } = await mounted(listing([task('1', { title: 'Buy milk' })]));

		const box = wrapper.find('input[type="checkbox"]');

		expect(box.exists()).toBe(true);
		expect(box.attributes('aria-label')).toContain('Buy milk');
	});

	it('completes through the dedicated endpoint and drops the row from the open list', async () => {
		const { wrapper, remote } = await mounted(listing([task('1')]));

		await wrapper.find('input[type="checkbox"]').setValue(true);
		await flushPromises();

		expect(remote.complete).toHaveBeenCalledWith('1');
		expect(wrapper.findAll('.list__row')).toHaveLength(0);
	});

	it('is safe to click twice — the endpoint is idempotent and the row is already gone', async () => {
		const { wrapper, remote } = await mounted(listing([task('1')]));

		const box = wrapper.find('input[type="checkbox"]');
		await box.setValue(true);
		await box.setValue(true);
		await flushPromises();

		expect(remote.complete).toHaveBeenCalledTimes(1);
	});

	it('puts the row back and says so when the server refuses', async () => {
		const { wrapper } = await mounted(
			fakeRemote({
				listAll: vi.fn().mockResolvedValue([task('1')]),
				complete: vi.fn().mockRejectedValue(failure(500)),
			}),
		);

		await wrapper.find('input[type="checkbox"]').setValue(true);
		await flushPromises();

		expect(wrapper.findAll('.list__row')).toHaveLength(1);
		expect(wrapper.find('.error').exists()).toBe(true);
	});
});

describe('the completed section', () => {
	const withCompleted = () =>
		listing([
			task('open'),
			task('old', { completed_at: '2026-08-01T10:00:00.000000Z' }),
			task('new', { completed_at: '2026-08-30T10:00:00.000000Z' }),
		]);

	it('is hidden until asked for', async () => {
		const { wrapper } = await mounted(withCompleted());

		expect(wrapper.find('[data-section="completed"]').exists()).toBe(false);
	});

	it('is revealed by a real button whose name says what it will do', async () => {
		const { wrapper } = await mounted(withCompleted());

		const toggle = wrapper.find('[data-action="toggle-completed"]');

		expect(toggle.element.tagName).toBe('BUTTON');
		expect(toggle.text()).toMatch(/show/i);

		await toggle.trigger('click');

		expect(wrapper.find('[data-section="completed"]').exists()).toBe(true);
		expect(wrapper.find('[data-action="toggle-completed"]').text()).toMatch(/hide/i);
	});

	it('lists what was finished most recently first', async () => {
		const { wrapper } = await mounted(withCompleted());

		await wrapper.find('[data-action="toggle-completed"]').trigger('click');

		const rows = wrapper.findAll('[data-section="completed"] .list__row');

		expect(rows.map((row) => row.text())).toEqual([
			expect.stringContaining('Task new'),
			expect.stringContaining('Task old'),
		]);
	});

	it('shows when each was completed', async () => {
		const { wrapper } = await mounted(withCompleted());

		await wrapper.find('[data-action="toggle-completed"]').trigger('click');

		expect(wrapper.find('[data-section="completed"] .list__secondary').text()).toMatch(/Aug/);
	});

	it('marks completed rows by more than colour', async () => {
		const { wrapper } = await mounted(withCompleted());

		await wrapper.find('[data-action="toggle-completed"]').trigger('click');

		expect(wrapper.find('[data-section="completed"] .list__row').text()).toMatch(/done/i);
	});

	it('reopens from here, returning the task to the open list', async () => {
		const { wrapper, remote } = await mounted(withCompleted());

		await wrapper.find('[data-action="toggle-completed"]').trigger('click');
		await wrapper.find('[data-section="completed"] input[type="checkbox"]').setValue(false);
		await flushPromises();

		expect(remote.reopen).toHaveBeenCalledWith('new');
		expect(wrapper.findAll('[data-section="completed"] .list__row')).toHaveLength(1);
	});

	it('says so rather than showing an empty section when nothing is finished', async () => {
		const { wrapper } = await mounted(listing([task('open')]));

		await wrapper.find('[data-action="toggle-completed"]').trigger('click');

		expect(wrapper.find('[data-section="completed"]').text()).toMatch(/nothing completed/i);
	});
});

describe('remembering the completed preference', () => {
	it('survives a reload', async () => {
		const first = await mounted(listing([task('1', { completed_at: '2026-08-30T10:00:00.000000Z' })]));
		await first.wrapper.find('[data-action="toggle-completed"]').trigger('click');

		const second = await mounted(
			listing([task('1', { completed_at: '2026-08-30T10:00:00.000000Z' })]),
		);

		expect(second.wrapper.find('[data-section="completed"]').exists()).toBe(true);
	});

	it('falls back to hidden when the stored value is nonsense rather than throwing', async () => {
		localStorage.setItem(COMPLETED_SHOWN_KEY, 'not-a-boolean');

		const { wrapper } = await mounted(listing([task('1')]));

		expect(wrapper.find('[data-section="completed"]').exists()).toBe(false);
	});

	it('falls back to hidden when localStorage cannot be read at all', async () => {
		const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('SecurityError');
		});

		const { wrapper } = await mounted(listing([task('1')]));

		expect(wrapper.find('[data-section="completed"]').exists()).toBe(false);
		getItem.mockRestore();
	});
});

describe('deleting from the list', () => {
	it('asks before deleting, naming the task', async () => {
		const { wrapper, remote } = await mounted(listing([task('1', { title: 'Buy milk' })]));

		await wrapper.find('[data-action="delete"]').trigger('click');

		expect(wrapper.find('.modal').exists()).toBe(true);
		expect(wrapper.find('.modal').text()).toContain('Buy milk');
		expect(remote.remove).not.toHaveBeenCalled();
	});

	it('deletes once confirmed', async () => {
		const { wrapper, remote } = await mounted(listing([task('1')]));

		await wrapper.find('[data-action="delete"]').trigger('click');
		await wrapper.find('[data-action="confirm"]').trigger('click');
		await flushPromises();

		expect(remote.remove).toHaveBeenCalledWith('1');
		expect(wrapper.findAll('.list__row')).toHaveLength(0);
	});

	it('leaves the task alone when the dialog is cancelled', async () => {
		const { wrapper, remote } = await mounted(listing([task('1')]));

		await wrapper.find('[data-action="delete"]').trigger('click');
		await wrapper.find('.modal').trigger('keydown', { key: 'Escape' });
		await flushPromises();

		expect(remote.remove).not.toHaveBeenCalled();
		expect(wrapper.findAll('.list__row')).toHaveLength(1);
	});

	it('treats an already-deleted task as deleted rather than reporting a 404', async () => {
		const { wrapper } = await mounted(
			fakeRemote({
				listAll: vi.fn().mockResolvedValue([task('1')]),
				remove: vi.fn().mockResolvedValue(null),
			}),
		);

		await wrapper.find('[data-action="delete"]').trigger('click');
		await wrapper.find('[data-action="confirm"]').trigger('click');
		await flushPromises();

		expect(wrapper.find('.error').exists()).toBe(false);
	});

	it('keeps the task and says so when the delete genuinely fails', async () => {
		const { wrapper } = await mounted(
			fakeRemote({
				listAll: vi.fn().mockResolvedValue([task('1')]),
				remove: vi.fn().mockRejectedValue(failure(500)),
			}),
		);

		await wrapper.find('[data-action="delete"]').trigger('click');
		await wrapper.find('[data-action="confirm"]').trigger('click');
		await flushPromises();

		expect(wrapper.findAll('.list__row')).toHaveLength(1);
		expect(wrapper.find('.error').exists()).toBe(true);
	});
});

describe('getting to the form', () => {
	it('offers a way to add a task', async () => {
		const { wrapper } = await mounted();

		expect(wrapper.find('[data-action="new-task"]').exists()).toBe(true);
	});

	it('opens a task for editing', async () => {
		const { wrapper } = await mounted(listing([task('1')]));

		await wrapper.find('[data-action="edit"]').trigger('click');

		expect(pushMock).toHaveBeenCalledWith('/tasks/1/edit');
	});
});
