import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import TaskFormView from '@/views/TaskFormView.vue';
import { useRemote, useTasksStore } from '@/stores/tasks';

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
		create: vi.fn((body) => Promise.resolve({ ...task('new'), ...body })),
		update: vi.fn((id, body) => Promise.resolve({ ...task(id), ...body })),
		replace: vi.fn(),
		complete: vi.fn(),
		reopen: vi.fn(),
		remove: vi.fn().mockResolvedValue(null),
		...over,
	};
}

async function mountForm(remote = fakeRemote(), existing = []) {
	const pinia = createPinia();
	setActivePinia(pinia);
	useRemote(remote);

	const store = useTasksStore();
	store.tasks = existing;
	store.loaded = true;
	store.loading = false;

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

const failure = (status, data = null) =>
	Object.assign(new Error(`Request failed (${status}).`), { status, data });

beforeEach(() => {
	routeRef.value = { params: {}, query: {} };
	pushMock.mockClear();
	replaceMock.mockClear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('creating a task', () => {
	it('sends what was typed and returns to the list', async () => {
		const { wrapper, remote } = await mountForm();

		await field(wrapper, 'title').setValue('Buy milk');
		await field(wrapper, 'notes').setValue('Semi-skimmed');
		await submit(wrapper);

		expect(remote.create).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Buy milk', notes: 'Semi-skimmed' }),
		);
		expect(pushMock).toHaveBeenCalledWith('/');
	});

	it('saves a blank title rather than refusing — the server names it "Untitled task"', async () => {
		const create = vi.fn().mockResolvedValue(task('new', { title: 'Untitled task' }));
		const { wrapper, remote } = await mountForm(fakeRemote({ create }));

		await submit(wrapper);

		expect(remote.create).toHaveBeenCalledOnce();
		expect(remote.create.mock.calls[0][0].title).toBe('');
		expect(pushMock).toHaveBeenCalledWith('/');
	});

	it('sends no due date when none was given', async () => {
		const { wrapper, remote } = await mountForm();

		await field(wrapper, 'title').setValue('Someday');
		await submit(wrapper);

		expect(remote.create.mock.calls[0][0].due_at).toBeNull();
	});
});

describe('the due date', () => {
	it('sends a date alone as a date, not as a midnight datetime', async () => {
		const { wrapper, remote } = await mountForm();

		await field(wrapper, 'due_date').setValue('2026-09-05');
		await submit(wrapper);

		expect(remote.create.mock.calls[0][0].due_at).toBe('2026-09-05');
	});

	it('sends the registered time exactly, with no zone conversion applied', async () => {
		const { wrapper, remote } = await mountForm();

		await field(wrapper, 'due_date').setValue('2026-09-05');
		await field(wrapper, 'due_time').setValue('14:30');
		await submit(wrapper);

		// 14:30 registered is 14:30 sent. Converting local→UTC here would send
		// some other hour and the app would show it back.
		expect(remote.create.mock.calls[0][0].due_at).toBe('2026-09-05T14:30:00Z');
	});

	it('ignores a time with no date — a time alone is not a due date', async () => {
		const { wrapper, remote } = await mountForm();

		await field(wrapper, 'due_time').setValue('14:30');
		await submit(wrapper);

		expect(remote.create.mock.calls[0][0].due_at).toBeNull();
	});

	it('clears the due date by sending null', async () => {
		routeRef.value = { params: { id: '1' }, query: {} };
		const { wrapper, remote } = await mountForm(fakeRemote(), [
			task('1', { due_at: '2026-09-05' }),
		]);

		await field(wrapper, 'due_date').setValue('');
		await submit(wrapper);

		expect(remote.update.mock.calls[0][1].due_at).toBeNull();
	});

	it('loads a date-only due date back into the date field alone', async () => {
		routeRef.value = { params: { id: '1' }, query: {} };
		const { wrapper } = await mountForm(fakeRemote(), [task('1', { due_at: '2026-09-05' })]);

		expect(field(wrapper, 'due_date').element.value).toBe('2026-09-05');
		expect(field(wrapper, 'due_time').element.value).toBe('');
	});

	it('loads a registered time back unchanged, not shifted into the browser zone', async () => {
		routeRef.value = { params: { id: '1' }, query: {} };
		const { wrapper } = await mountForm(fakeRemote(), [
			task('1', { due_at: '2026-09-05T14:30:00.000000Z' }),
		]);

		expect(field(wrapper, 'due_date').element.value).toBe('2026-09-05');
		expect(field(wrapper, 'due_time').element.value).toBe('14:30');
	});
});

describe('editing a task', () => {
	it('fills the form from the task being edited', async () => {
		routeRef.value = { params: { id: '1' }, query: {} };
		const { wrapper } = await mountForm(fakeRemote(), [
			task('1', { title: 'Buy milk', notes: 'Semi-skimmed' }),
		]);

		expect(field(wrapper, 'title').element.value).toBe('Buy milk');
		expect(field(wrapper, 'notes').element.value).toBe('Semi-skimmed');
	});

	it('fetches the task when it is not already loaded, so a deep link works', async () => {
		routeRef.value = { params: { id: '1' }, query: {} };
		const get = vi.fn().mockResolvedValue(task('1', { title: 'Buy milk' }));
		const { wrapper } = await mountForm(fakeRemote({ get }), []);

		expect(get).toHaveBeenCalledWith('1');
		expect(field(wrapper, 'title').element.value).toBe('Buy milk');
	});

	it('saves the change and returns to the list', async () => {
		routeRef.value = { params: { id: '1' }, query: {} };
		const { wrapper, remote } = await mountForm(fakeRemote(), [task('1')]);

		await field(wrapper, 'title').setValue('Renamed');
		await submit(wrapper);

		expect(remote.update).toHaveBeenCalledWith('1', expect.objectContaining({ title: 'Renamed' }));
		expect(pushMock).toHaveBeenCalledWith('/');
	});

	it('does not reopen a completed task it is editing', async () => {
		routeRef.value = { params: { id: '1' }, query: {} };
		const completed = task('1', { completed_at: '2026-08-30T10:00:00.000000Z' });
		const { wrapper, remote } = await mountForm(fakeRemote(), [completed]);

		await field(wrapper, 'title').setValue('Renamed');
		await submit(wrapper);

		// The trap: a PUT omitting completed_at reopens the task. A PATCH that
		// never mentions it cannot.
		expect(remote.update.mock.calls[0][1]).not.toHaveProperty('completed_at');
		expect(remote.replace).not.toHaveBeenCalled();
	});
});

describe('when the save is refused', () => {
	it('shows the server field message against the field, keeping what was typed', async () => {
		const create = vi
			.fn()
			.mockRejectedValue(failure(422, { errors: { title: ['The title is too long.'] } }));
		const { wrapper } = await mountForm(fakeRemote({ create }));

		await field(wrapper, 'title').setValue('A very long title');
		await submit(wrapper);

		expect(wrapper.find('.field__error').text()).toContain('The title is too long.');
		expect(field(wrapper, 'title').element.value).toBe('A very long title');
		expect(pushMock).not.toHaveBeenCalled();
	});

	it('keeps the form populated when the connection drops, so nothing is retyped', async () => {
		const create = vi.fn().mockRejectedValue(failure(0));
		const { wrapper } = await mountForm(fakeRemote({ create }));

		await field(wrapper, 'title').setValue('Buy milk');
		await field(wrapper, 'notes').setValue('Semi-skimmed');
		await submit(wrapper);

		expect(wrapper.find('.error').exists()).toBe(true);
		expect(field(wrapper, 'title').element.value).toBe('Buy milk');
		expect(field(wrapper, 'notes').element.value).toBe('Semi-skimmed');
		expect(pushMock).not.toHaveBeenCalled();
	});
});

describe('deleting from the form', () => {
	it('asks before deleting rather than acting on the click', async () => {
		routeRef.value = { params: { id: '1' }, query: {} };
		const { wrapper, remote } = await mountForm(fakeRemote(), [task('1')]);

		await wrapper.find('[data-action="delete"]').trigger('click');

		expect(wrapper.find('.modal').exists()).toBe(true);
		expect(remote.remove).not.toHaveBeenCalled();
	});

	it('deletes and returns to the list once confirmed', async () => {
		routeRef.value = { params: { id: '1' }, query: {} };
		const { wrapper, remote } = await mountForm(fakeRemote(), [task('1')]);

		await wrapper.find('[data-action="delete"]').trigger('click');
		await wrapper.find('[data-action="confirm"]').trigger('click');
		await flushPromises();

		expect(remote.remove).toHaveBeenCalledWith('1');
		expect(pushMock).toHaveBeenCalledWith('/');
	});

	it('offers no delete while creating — there is nothing to delete yet', async () => {
		const { wrapper } = await mountForm();

		expect(wrapper.find('[data-action="delete"]').exists()).toBe(false);
	});
});
