import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import TaskFormView from '@/views/TaskFormView.vue';
import { useRemote, useTasksStore } from '@/stores/tasks';
import { fakeServer, failing, task } from '../support/server';

const { pushMock, replaceMock, routeRef } = vi.hoisted(() => ({
	pushMock: vi.fn(),
	replaceMock: vi.fn(),
	routeRef: { value: { params: {}, query: {} } },
}));
vi.mock('vue-router', () => ({
	useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
	useRoute: () => routeRef.value,
	RouterLink: { template: '<a><slot /></a>' },
}));

/**
 * `prime` decides whether the device has already seen the server's list. Off is
 * how a deep link arrives on a browser that has never opened the app.
 */
async function mountForm(remote = fakeServer(), existing = [], { prime = true } = {}) {
	for (const record of existing) {
		remote.records.set(record.id, record);
	}

	const pinia = createPinia();
	setActivePinia(pinia);
	useRemote(remote);

	const store = useTasksStore();

	if (prime) {
		await store.syncNow();
	}

	const wrapper = mount(TaskFormView, {
		global: { plugins: [pinia], stubs: { RouterLink: true } },
	});
	await flushPromises();

	return { wrapper, remote, store };
}

const field = (wrapper, name) => wrapper.find(`[name="${name}"]`);

async function submit(wrapper) {
	await wrapper.find('form').trigger('submit');
	await flushPromises();
}

const editing = (id = '1') => {
	routeRef.value = { params: { id }, query: {} };
};

/** What the form saved, as it reached the server. */
const sentCreate = (remote) => remote.create.mock.calls[0][0];
const sentUpdate = (remote) => remote.update.mock.calls[0][1];

beforeEach(() => {
	routeRef.value = { params: {}, query: {} };
	pushMock.mockClear();
	replaceMock.mockClear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('creating a task', () => {
	it('saves what was typed and returns to the list', async () => {
		const { wrapper, store, remote } = await mountForm();

		await field(wrapper, 'title').setValue('Buy milk');
		await field(wrapper, 'notes').setValue('Semi-skimmed');
		await submit(wrapper);

		expect(store.tasks.map((t) => t.title)).toEqual(['Buy milk']);
		expect(pushMock).toHaveBeenCalledWith('/');

		await store.syncNow();

		expect(sentCreate(remote)).toMatchObject({ title: 'Buy milk', notes: 'Semi-skimmed' });
	});

	it('returns to the list without waiting for the server', async () => {
		// The task is on the device the moment Save is pressed. Making the user
		// watch a spinner for a round-trip that may never happen is the thing
		// offline-first exists to stop.
		const { wrapper, remote } = await mountForm();

		await field(wrapper, 'title').setValue('Buy milk');
		await submit(wrapper);

		expect(pushMock).toHaveBeenCalledWith('/');
		expect(remote.create).not.toHaveBeenCalled();
	});

	it('saves a blank title rather than refusing — the server names it "Untitled task"', async () => {
		const { wrapper, store, remote } = await mountForm();

		await submit(wrapper);

		expect(pushMock).toHaveBeenCalledWith('/');

		await store.syncNow();

		expect(sentCreate(remote).title).toBe('');
	});

	it('sends no due date when none was given', async () => {
		const { wrapper, store, remote } = await mountForm();

		await field(wrapper, 'title').setValue('Someday');
		await submit(wrapper);
		await store.syncNow();

		expect(sentCreate(remote).due_at).toBeNull();
	});
});

describe('the duration', () => {
	it('offers a field in minutes, because that is the unit the record stores', async () => {
		const { wrapper } = await mountForm();

		expect(field(wrapper, 'duration').exists()).toBe(true);
		expect(field(wrapper, 'duration').attributes('type')).toBe('number');
	});

	it('saves the minutes that were typed', async () => {
		const { wrapper, store, remote } = await mountForm();

		await field(wrapper, 'title').setValue('Write docs');
		await field(wrapper, 'duration').setValue('45');
		await submit(wrapper);
		await store.syncNow();

		expect(sentCreate(remote).duration).toBe(45);
	});

	it('sends no duration when the field is left empty, rather than zero', async () => {
		const { wrapper, store, remote } = await mountForm();

		await field(wrapper, 'title').setValue('Someday');
		await submit(wrapper);
		await store.syncNow();

		expect(sentCreate(remote).duration).toBeNull();
	});

	it('loads a stored duration back into the field', async () => {
		editing();
		const { wrapper } = await mountForm(fakeServer(), [task('1', { duration: 45 })]);

		expect(field(wrapper, 'duration').element.value).toBe('45');
	});

	it('leaves the field blank for a task with no estimate, not showing a 0', async () => {
		editing();
		const { wrapper } = await mountForm(fakeServer(), [task('1')]);

		expect(field(wrapper, 'duration').element.value).toBe('');
	});

	it('clears a duration with an explicit null, since an absent key would keep it', async () => {
		editing();
		const { wrapper, store, remote } = await mountForm(fakeServer(), [task('1', { duration: 45 })]);

		await field(wrapper, 'duration').setValue('');
		await submit(wrapper);
		await store.syncNow();

		expect(sentUpdate(remote)).toHaveProperty('duration', null);
	});

	it('keeps a duration an edit never touched', async () => {
		editing();
		const { wrapper, store, remote } = await mountForm(fakeServer(), [task('1', { duration: 45 })]);

		await field(wrapper, 'title').setValue('Renamed');
		await submit(wrapper);
		await store.syncNow();

		expect(sentUpdate(remote).duration).toBe(45);
	});

	it('saves rather than refusing when the field holds something unreadable', async () => {
		// "Minimize computer says no": a stray keystroke in an optional estimate
		// must never cost the user the rest of the form.
		const { wrapper, store, remote } = await mountForm();

		await field(wrapper, 'title').setValue('Buy milk');
		await field(wrapper, 'duration').setValue('not a number');
		await submit(wrapper);

		expect(pushMock).toHaveBeenCalledWith('/');

		await store.syncNow();

		expect(sentCreate(remote)).toMatchObject({ title: 'Buy milk', duration: null });
	});
});

describe('the due date', () => {
	it('offers a date alone — the form registers a day, not a time of day', async () => {
		const { wrapper } = await mountForm();

		expect(field(wrapper, 'due_date').exists()).toBe(true);
		expect(field(wrapper, 'due_time').exists()).toBe(false);
	});

	it('sends a date alone as a date, not as a midnight datetime', async () => {
		const { wrapper, store, remote } = await mountForm();

		await field(wrapper, 'due_date').setValue('2026-09-05');
		await submit(wrapper);
		await store.syncNow();

		expect(sentCreate(remote).due_at).toBe('2026-09-05');
	});

	it('clears the due date by sending null', async () => {
		editing();
		const { wrapper, store, remote } = await mountForm(fakeServer(), [
			task('1', { due_at: '2026-09-05' }),
		]);

		await field(wrapper, 'due_date').setValue('');
		await submit(wrapper);
		await store.syncNow();

		expect(sentUpdate(remote).due_at).toBeNull();
	});

	it('loads a date-only due date back into the date field', async () => {
		editing();
		const { wrapper } = await mountForm(fakeServer(), [task('1', { due_at: '2026-09-05' })]);

		expect(field(wrapper, 'due_date').element.value).toBe('2026-09-05');
	});

	it('shows only the day of a task registered with a time', async () => {
		editing();
		const { wrapper } = await mountForm(fakeServer(), [
			task('1', { due_at: '2026-09-05T14:30:00.000000Z' }),
		]);

		expect(field(wrapper, 'due_date').element.value).toBe('2026-09-05');
	});

	it('keeps a registered time the form no longer shows, rather than silently dropping it', async () => {
		editing();
		const { wrapper, store, remote } = await mountForm(fakeServer(), [
			task('1', { due_at: '2026-09-05T14:30:00.000000Z' }),
		]);

		await field(wrapper, 'title').setValue('Renamed');
		await submit(wrapper);
		await store.syncNow();

		// An edit that never touched the due date must not turn "Friday at 14:30"
		// into "Friday, some time" — the field is gone from the form, not from
		// the record.
		expect(sentUpdate(remote).due_at).toBe('2026-09-05T14:30:00Z');
	});

	it('carries the registered time over to a new day when the date is changed', async () => {
		editing();
		const { wrapper, store, remote } = await mountForm(fakeServer(), [
			task('1', { due_at: '2026-09-05T14:30:00.000000Z' }),
		]);

		await field(wrapper, 'due_date').setValue('2026-09-06');
		await submit(wrapper);
		await store.syncNow();

		expect(sentUpdate(remote).due_at).toBe('2026-09-06T14:30:00Z');
	});

	it('drops the registered time once the due date is cleared', async () => {
		editing();
		const { wrapper, store, remote } = await mountForm(fakeServer(), [
			task('1', { due_at: '2026-09-05T14:30:00.000000Z' }),
		]);

		await field(wrapper, 'due_date').setValue('');
		await submit(wrapper);
		await store.syncNow();

		expect(sentUpdate(remote).due_at).toBeNull();
	});
});

describe('editing a task', () => {
	it('fills the form from the task being edited', async () => {
		editing();
		const { wrapper } = await mountForm(fakeServer(), [
			task('1', { title: 'Buy milk', notes: 'Semi-skimmed' }),
		]);

		expect(field(wrapper, 'title').element.value).toBe('Buy milk');
		expect(field(wrapper, 'notes').element.value).toBe('Semi-skimmed');
	});

	it('syncs for a deep link that arrived before this device had the list', async () => {
		editing();
		const { wrapper, remote } = await mountForm(
			fakeServer(),
			[task('1', { title: 'Buy milk' })],
			{ prime: false },
		);

		expect(remote.listAll).toHaveBeenCalled();
		expect(field(wrapper, 'title').element.value).toBe('Buy milk');
	});

	it('opens a task held only on this device without reaching for the network', async () => {
		// A task created offline has no server record at all. Refusing to open it
		// would make the app unusable for exactly the work it just accepted.
		const pinia = createPinia();
		setActivePinia(pinia);
		const remote = fakeServer();
		useRemote(remote);

		const store = useTasksStore();
		const created = await store.create({ title: 'Buy milk', notes: null, due_at: null, duration: null });

		routeRef.value = { params: { id: created.id }, query: {} };
		remote.listAll.mockClear();

		const wrapper = mount(TaskFormView, { global: { plugins: [pinia], stubs: { RouterLink: true } } });
		await flushPromises();

		expect(field(wrapper, 'title').element.value).toBe('Buy milk');
		expect(remote.listAll).not.toHaveBeenCalled();
	});

	it('saves the change and returns to the list', async () => {
		editing();
		const { wrapper, store, remote } = await mountForm(fakeServer(), [task('1')]);

		await field(wrapper, 'title').setValue('Renamed');
		await submit(wrapper);

		expect(pushMock).toHaveBeenCalledWith('/');

		await store.syncNow();

		expect(remote.update).toHaveBeenCalledWith('1', expect.objectContaining({ title: 'Renamed' }));
	});

	it('does not reopen a completed task it is editing', async () => {
		editing();
		const { wrapper, store, remote } = await mountForm(fakeServer(), [
			task('1', { completed_at: '2026-08-30T10:00:00.000000Z' }),
		]);

		await field(wrapper, 'title').setValue('Renamed');
		await submit(wrapper);
		await store.syncNow();

		// The trap: anything that carries completed_at can reopen the task once it
		// is coalesced with another edit. An edit never mentions it.
		expect(sentUpdate(remote)).not.toHaveProperty('completed_at');
		expect(remote.replace).not.toHaveBeenCalled();
		expect(store.tasks[0].completed_at).toBe('2026-08-30T10:00:00.000000Z');
	});
});

describe('when the task cannot be found', () => {
	it('says so rather than showing a blank form that looks editable', async () => {
		editing();
		const remote = fakeServer();
		remote.listAll = failing(500);

		const { wrapper } = await mountForm(remote, [], { prime: false });

		expect(wrapper.find('.error').exists()).toBe(true);
	});

	it('refuses to save, so a failed load cannot blank the real task', async () => {
		editing();
		const remote = fakeServer();
		remote.listAll = failing(500);

		const { wrapper, store } = await mountForm(remote, [], { prime: false });

		// The trap: an empty form saved over a real record wipes its title, notes,
		// duration and due date because of one transient failure.
		expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined();

		await submit(wrapper);

		expect(store.tasks).toEqual([]);
	});
});

describe('saving with no connection', () => {
	it('saves anyway and returns to the list', async () => {
		const remote = fakeServer();
		remote.listAll = failing(0);
		remote.create = failing(0);

		const { wrapper, store } = await mountForm(remote, [], { prime: false });

		await field(wrapper, 'title').setValue('Buy milk');
		await submit(wrapper);

		expect(store.tasks.map((t) => t.title)).toEqual(['Buy milk']);
		expect(pushMock).toHaveBeenCalledWith('/');
	});

	it('keeps the task queued so it goes out when the connection returns', async () => {
		const remote = fakeServer();
		remote.listAll = failing(0);
		remote.create = failing(0);

		const { wrapper, store } = await mountForm(remote, [], { prime: false });

		await field(wrapper, 'title').setValue('Buy milk');
		await submit(wrapper);

		expect(store.pendingCount).toBe(1);
	});
});

describe('deleting from the form', () => {
	it('asks before deleting rather than acting on the click', async () => {
		editing();
		const { wrapper, store } = await mountForm(fakeServer(), [task('1')]);

		await wrapper.find('[data-action="delete"]').trigger('click');

		expect(wrapper.find('.modal').exists()).toBe(true);
		expect(store.tasks).toHaveLength(1);
	});

	it('deletes and returns to the list once confirmed', async () => {
		editing();
		const { wrapper, store, remote } = await mountForm(fakeServer(), [task('1')]);

		await wrapper.find('[data-action="delete"]').trigger('click');
		await wrapper.find('[data-action="confirm"]').trigger('click');
		await flushPromises();

		expect(store.tasks).toEqual([]);
		expect(pushMock).toHaveBeenCalledWith('/');

		await store.syncNow();

		expect(remote.remove).toHaveBeenCalledWith('1');
	});

	it('deletes with no connection, and sends it later', async () => {
		editing();
		const remote = fakeServer([task('1')]);
		const { wrapper, store } = await mountForm(remote, []);

		remote.listAll = failing(0);
		remote.remove = failing(0);

		await wrapper.find('[data-action="delete"]').trigger('click');
		await wrapper.find('[data-action="confirm"]').trigger('click');
		await flushPromises();

		expect(store.tasks).toEqual([]);
		expect(pushMock).toHaveBeenCalledWith('/');
	});

	it('offers no delete while creating — there is nothing to delete yet', async () => {
		const { wrapper } = await mountForm();

		expect(wrapper.find('[data-action="delete"]').exists()).toBe(false);
	});
});
