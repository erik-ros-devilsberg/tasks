import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';

import { useDragReorder } from '@/composables/useDragReorder';

/*
 * jsdom has no layout, so row geometry is handed in through `measure`: three
 * rows of 40px stacked from the top. Midpoints at 20, 60 and 100 are what a
 * pointer is compared against.
 */
const BOUNDS = {
	a: { top: 0, bottom: 40 },
	b: { top: 40, bottom: 80 },
	c: { top: 80, bottom: 120 },
};

function rowsFor(ids) {
	return ids.map((id) => {
		const el = document.createElement('li');
		el.dataset.id = id;

		return { id, el };
	});
}

const measure = (el) => BOUNDS[el.dataset.id];

/**
 * The composable needs a component to own its lifecycle — Escape and the
 * pointer listeners have to be torn down with it.
 */
function host({ rows = rowsFor(['a', 'b', 'c']), onDrop = vi.fn() } = {}) {
	const wrapper = mount({
		template: '<div />',
		setup() {
			const drag = useDragReorder({ rows: () => rows, measure, onDrop });

			return { drag };
		},
	});

	return { wrapper, drag: wrapper.vm.drag, rows, onDrop };
}

/** What the handle's `@pointerdown` hands over. */
function press(rows, id, clientY, over = {}) {
	return {
		button: 0,
		pointerType: 'mouse',
		pointerId: 1,
		clientX: 10,
		clientY,
		currentTarget: rows.find((row) => row.id === id).el,
		preventDefault: vi.fn(),
		...over,
	};
}

const move = (clientY) => window.dispatchEvent(new MouseEvent('pointermove', { clientY, clientX: 10 }));
const release = (clientY) => window.dispatchEvent(new MouseEvent('pointerup', { clientY, clientX: 10 }));
const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

let mounted;

beforeEach(() => {
	mounted = null;
});

afterEach(() => {
	mounted?.wrapper.unmount();
	vi.restoreAllMocks();
});

describe('starting a drag', () => {
	it('marks the pressed row as dragging and shows no target while it sits on its own slot', () => {
		mounted = host();
		const { drag, rows } = mounted;

		drag.start(press(rows, 'a', 20), 'a');

		expect(drag.draggingId).toBe('a');
		expect(drag.target).toBeNull();
	});

	it('ignores a secondary mouse button — a right click is a context menu, not a drag', () => {
		mounted = host();
		const { drag, rows } = mounted;

		drag.start(press(rows, 'a', 20, { button: 2 }), 'a');

		expect(drag.draggingId).toBeNull();
	});

	it('prevents the default so the press does not select text or scroll the page', () => {
		mounted = host();
		const { drag, rows } = mounted;
		const event = press(rows, 'a', 20);

		drag.start(event, 'a');

		expect(event.preventDefault).toHaveBeenCalled();
	});
});

describe('moving', () => {
	it('targets the slot before the row whose upper half the pointer is in', () => {
		mounted = host();
		const { drag, rows } = mounted;
		drag.start(press(rows, 'a', 20), 'a');

		// Below b's midpoint (60), above c's (100): between b and c, before c.
		move(70);

		expect(drag.target).toEqual({ beforeId: 'c', index: 1 });
	});

	it('targets the slot after the last row once the pointer passes its midpoint', () => {
		mounted = host();
		const { drag, rows } = mounted;
		drag.start(press(rows, 'a', 20), 'a');

		move(110);

		expect(drag.target).toEqual({ afterId: 'c', index: 2 });
	});

	it('targets the very top when the pointer is above the first remaining row’s midpoint', () => {
		mounted = host();
		const { drag, rows } = mounted;
		drag.start(press(rows, 'c', 100), 'c');

		move(10);

		expect(drag.target).toEqual({ beforeId: 'a', index: 0 });
	});

	it('clears the target again when the pointer returns to the row’s own slot', () => {
		mounted = host();
		const { drag, rows } = mounted;
		drag.start(press(rows, 'a', 20), 'a');

		move(110);
		move(15);

		expect(drag.target).toBeNull();
	});

	it('does not count the dragged row itself — the index is in the list without it', () => {
		mounted = host();
		const { drag, rows } = mounted;
		drag.start(press(rows, 'b', 60), 'b');

		// Rest is [a, c] with midpoints 20 and 100. 70 is past a, before c: index 1
		// — which is b's own slot, so no target.
		move(70);

		expect(drag.target).toBeNull();

		move(110);

		expect(drag.target).toEqual({ afterId: 'c', index: 2 });
	});
});

describe('releasing', () => {
	it('drops once, with the id and the resulting index', () => {
		mounted = host();
		const { drag, rows, onDrop } = mounted;
		drag.start(press(rows, 'a', 20), 'a');

		move(110);
		release(110);

		expect(onDrop).toHaveBeenCalledTimes(1);
		expect(onDrop).toHaveBeenCalledWith('a', 2);
	});

	it('calls nothing when released on its own slot', () => {
		mounted = host();
		const { drag, rows, onDrop } = mounted;
		drag.start(press(rows, 'a', 20), 'a');

		move(30);
		release(30);

		expect(onDrop).not.toHaveBeenCalled();
	});

	it('cancels when released outside the list — nothing moves, nothing is saved', () => {
		mounted = host();
		const { drag, rows, onDrop } = mounted;
		drag.start(press(rows, 'a', 20), 'a');

		move(110);
		release(500);

		expect(onDrop).not.toHaveBeenCalled();
		expect(drag.draggingId).toBeNull();
		expect(drag.target).toBeNull();
	});

	it('resets its state after a drop, so the next press starts clean', () => {
		mounted = host();
		const { drag, rows } = mounted;
		drag.start(press(rows, 'a', 20), 'a');

		move(110);
		release(110);

		expect(drag.draggingId).toBeNull();
		expect(drag.target).toBeNull();
	});

	it('cancels on pointercancel — the browser took the pointer for a scroll or a gesture', () => {
		mounted = host();
		const { drag, rows, onDrop } = mounted;
		drag.start(press(rows, 'a', 20), 'a');

		move(110);
		window.dispatchEvent(new Event('pointercancel'));

		expect(onDrop).not.toHaveBeenCalled();
		expect(drag.draggingId).toBeNull();
	});
});

describe('escape', () => {
	it('cancels the drag and keeps the list as it was', () => {
		mounted = host();
		const { drag, rows, onDrop } = mounted;
		drag.start(press(rows, 'a', 20), 'a');

		move(110);
		escape();

		expect(drag.draggingId).toBeNull();
		expect(drag.target).toBeNull();
		expect(onDrop).not.toHaveBeenCalled();
	});

	it('is ignored when nothing is being dragged', () => {
		mounted = host();

		expect(() => escape()).not.toThrow();
		expect(mounted.drag.draggingId).toBeNull();
	});

	it('is fully cancelled — a release after Escape drops nothing', () => {
		mounted = host();
		const { drag, rows, onDrop } = mounted;
		drag.start(press(rows, 'a', 20), 'a');

		move(110);
		escape();
		release(110);

		expect(onDrop).not.toHaveBeenCalled();
	});
});

describe('teardown', () => {
	it('stops listening when the component unmounts mid-drag', () => {
		mounted = host();
		const { wrapper, drag, rows, onDrop } = mounted;
		drag.start(press(rows, 'a', 20), 'a');
		move(110);

		wrapper.unmount();
		mounted = null;
		release(110);

		expect(onDrop).not.toHaveBeenCalled();
	});
});
