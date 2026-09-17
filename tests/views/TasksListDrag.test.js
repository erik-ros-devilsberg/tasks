import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import TasksListView from '@/views/TasksListView.vue';
import { useRemote, useTasksStore } from '@/stores/tasks';
import { fakeServer, task } from '../support/server';

enableAutoUnmount(afterEach);

const { pushMock, replaceMock, route } = await vi.hoisted(async () => {
	const { reactive } = await import('vue');
	return { pushMock: vi.fn(), replaceMock: vi.fn(), route: reactive({ query: {} }) };
});
vi.mock('vue-router', () => ({
	useRouter: () => ({ push: pushMock, replace: replaceMock }),
	useRoute: () => route,
	RouterLink: { template: '<a><slot /></a>' },
}));

const ROW_HEIGHT = 40;

/*
 * jsdom lays nothing out, so every row reports a box from its position in
 * the list: the n-th <li> spans n*40 to n*40+40. That is enough for the view's
 * real `getBoundingClientRect` path to compute slots the way a browser would.
 */
function stubLayout() {
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
		const parent = this.parentElement;
		const index = parent ? [...parent.children].indexOf(this) : 0;
		const top = index * ROW_HEIGHT;

		return { top, bottom: top + ROW_HEIGHT, left: 0, right: 300, width: 300, height: ROW_HEIGHT, x: 0, y: top };
	});
}

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

const NOW = new Date(2026, 7, 30, 12, 0);
const DONE = '2026-08-29T10:00:00.000000Z';

const handles = (wrapper) => wrapper.findAll('[data-action="reorder"]');
const rowOf = (wrapper, title) =>
	wrapper.findAll('.list__row').find((row) => row.find('[data-action="open"]').text().includes(title));

const move = (clientY) => window.dispatchEvent(new MouseEvent('pointermove', { clientY, clientX: 10 }));
const release = (clientY) => window.dispatchEvent(new MouseEvent('pointerup', { clientY, clientX: 10 }));

beforeEach(() => {
	localStorage.clear();
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
	pushMock.mockClear();
	route.query = {};
	stubLayout();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const three = () =>
	fakeServer([
		task('a', { title: 'Alpha', due_at: '2026-09-01', order: 0 }),
		task('b', { title: 'Bravo', due_at: '2026-09-01', order: 1 }),
		task('c', { title: 'Charlie', due_at: '2026-09-01', order: 2 }),
	]);

describe('the handle', () => {
	it('sits on every open row, named for the task', async () => {
		const { wrapper } = await mounted(three());

		expect(handles(wrapper)).toHaveLength(3);
		expect(handles(wrapper)[0].attributes('aria-label')).toBe('Reorder Alpha');
	});

	it('is the last thing in the row — at the right end, after the name', async () => {
		const { wrapper } = await mounted(three());
		const row = rowOf(wrapper, 'Alpha');

		expect(row.element.lastElementChild.getAttribute('data-action')).toBe('reorder');
	});

	it('is absent from a completed row', async () => {
		const { wrapper } = await mounted(
			fakeServer([task('a', { title: 'Alpha' }), task('d', { title: 'Done', completed_at: DONE })]),
			{ completedShown: true },
		);

		expect(handles(wrapper)).toHaveLength(1);
		expect(rowOf(wrapper, 'Done').find('[data-action="reorder"]').exists()).toBe(false);
	});

	it('is absent in delete mode — dragging and selecting never coexist', async () => {
		route.query = { mode: 'delete' };
		const { wrapper } = await mounted(three());

		expect(handles(wrapper)).toHaveLength(0);
	});

	it('does not open the form or complete the task when pressed', async () => {
		const { wrapper, remote } = await mounted(three());

		await handles(wrapper)[0].trigger('pointerdown', { button: 0, clientY: 20 });
		await handles(wrapper)[0].trigger('click');
		release(20);
		await flushPromises();

		expect(pushMock).not.toHaveBeenCalled();
		expect(remote.complete).not.toHaveBeenCalled();
	});
});

describe('dragging', () => {
	it('marks the row being dragged', async () => {
		const { wrapper } = await mounted(three());

		await handles(wrapper)[0].trigger('pointerdown', { button: 0, clientY: 20 });

		expect(rowOf(wrapper, 'Alpha').classes()).toContain('is-dragging');
	});

	it('shows the slot the task will land in, on the row it will sit before', async () => {
		const { wrapper } = await mounted(three());

		await handles(wrapper)[0].trigger('pointerdown', { button: 0, clientY: 20 });
		move(70);
		await flushPromises();

		expect(rowOf(wrapper, 'Charlie').classes()).toContain('is-drop-before');
	});

	it('shows the slot after the last open row when dragged past it', async () => {
		const { wrapper } = await mounted(three());

		await handles(wrapper)[0].trigger('pointerdown', { button: 0, clientY: 20 });
		move(110);
		await flushPromises();

		expect(rowOf(wrapper, 'Charlie').classes()).toContain('is-drop-after');
	});

	it('never offers a slot among completed rows — they are not positions', async () => {
		const { wrapper } = await mounted(
			fakeServer([
				task('a', { title: 'Alpha', due_at: '2026-09-01', order: 0 }),
				task('b', { title: 'Bravo', due_at: '2026-09-01', order: 1 }),
				task('d', { title: 'Done', completed_at: DONE }),
			]),
			{ completedShown: true },
		);

		await handles(wrapper)[0].trigger('pointerdown', { button: 0, clientY: 20 });
		// Over the completed row, which sits third (80–120).
		move(100);
		await flushPromises();

		expect(rowOf(wrapper, 'Done').classes()).not.toContain('is-drop-before');
		expect(rowOf(wrapper, 'Done').classes()).not.toContain('is-drop-after');
		expect(rowOf(wrapper, 'Bravo').classes()).toContain('is-drop-after');
	});

	it('clears every mark on Escape', async () => {
		const { wrapper } = await mounted(three());

		await handles(wrapper)[0].trigger('pointerdown', { button: 0, clientY: 20 });
		move(110);
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await flushPromises();

		expect(wrapper.find('.is-dragging').exists()).toBe(false);
		expect(wrapper.find('.is-drop-before').exists()).toBe(false);
		expect(wrapper.find('.is-drop-after').exists()).toBe(false);
	});
});

describe('the drop', () => {
	it('re-sorts the list at once and sends the renumbering', async () => {
		const { wrapper, remote } = await mounted(three());

		await handles(wrapper)[0].trigger('pointerdown', { button: 0, clientY: 20 });
		move(110);
		release(110);
		await flushPromises();

		// The name button also carries a screen-reader word, so match the start.
		const titles = wrapper.findAll('[data-action="open"]').map((el) => el.text().trim());

		expect(titles[0]).toMatch(/^Bravo/);
		expect(titles[1]).toMatch(/^Charlie/);
		expect(titles[2]).toMatch(/^Alpha/);
		expect(remote.update).toHaveBeenCalledWith('a', { order: 2 });
		expect(remote.update).toHaveBeenCalledWith('b', { order: 0 });
		expect(remote.update).toHaveBeenCalledWith('c', { order: 1 });
	});

	it('changes nothing when released on its own slot', async () => {
		const { wrapper, remote } = await mounted(three());

		await handles(wrapper)[0].trigger('pointerdown', { button: 0, clientY: 20 });
		move(30);
		release(30);
		await flushPromises();

		expect(remote.update).not.toHaveBeenCalled();
	});

	it('changes nothing when released outside the list', async () => {
		const { wrapper, remote } = await mounted(three());

		await handles(wrapper)[0].trigger('pointerdown', { button: 0, clientY: 20 });
		move(110);
		release(900);
		await flushPromises();

		expect(remote.update).not.toHaveBeenCalled();
		expect(wrapper.find('.is-dragging').exists()).toBe(false);
	});

	it('recolours a row that changed day — an undated task dropped into today turns amber', async () => {
		const { wrapper, remote } = await mounted(
			fakeServer([
				task('t1', { title: 'Today one', due_at: '2026-08-30', order: 0 }),
				task('t2', { title: 'Today two', due_at: '2026-08-30', order: 1 }),
				task('n', { title: 'Nowhere' }),
			]),
		);

		expect(rowOf(wrapper, 'Nowhere').classes()).toContain('list__row--undated');

		// Third row (80–120) dragged to the top.
		await handles(wrapper)[2].trigger('pointerdown', { button: 0, clientY: 100 });
		move(5);
		release(5);
		await flushPromises();

		expect(rowOf(wrapper, 'Nowhere').classes()).toContain('list__row--today');
		expect(remote.update).toHaveBeenCalledWith('n', { order: 0, due_at: '2026-08-30' });
	});
});
