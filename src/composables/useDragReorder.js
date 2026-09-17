import { onUnmounted, reactive, ref } from 'vue';

/**
 * Drag a row to a new slot, with a mouse or a finger.
 *
 * Pointer Events rather than the HTML5 drag-and-drop API, which Android Chrome
 * does not start from touch, and rather than a library, which would be the
 * app's first runtime dependency beyond Vue. One code path for both inputs,
 * and it is testable in jsdom.
 *
 * Geometry comes in through `measure(el) → { top, bottom }` rather than being
 * read here: jsdom has no layout, and a slot computed from bounds nobody can
 * hand in is a slot nobody can test. Slots are found from coordinates, not from
 * event targets — with the pointer captured on the handle, `pointermove` never
 * reports the row underneath anyway.
 *
 * `rows()` returns the draggable rows in displayed order as `{ id, el }`. It is
 * the caller's job to leave completed rows out: a slot is an index into this
 * list, and the store measures a drop the same way.
 *
 * `target` is null while the task sits on its own slot — a drop there changes
 * nothing, and an indicator promising a move that will not happen is a lie.
 */
export function useDragReorder({ rows, measure, onDrop }) {
	const draggingId = ref(null);
	const target = ref(null);

	let origin = -1;

	const midpoint = (el) => {
		const { top, bottom } = measure(el);

		return (top + bottom) / 2;
	};

	/**
	 * The index the task would occupy after a drop at `clientY`: the number of
	 * remaining rows whose midpoint the pointer has passed. Past the last one
	 * is the slot after it.
	 */
	function slotAt(clientY) {
		const rest = rows().filter((row) => row.id !== draggingId.value);
		let index = 0;

		for (const row of rest) {
			if (clientY > midpoint(row.el)) {
				index += 1;
			}
		}

		if (index === origin) {
			return null;
		}

		if (index < rest.length) {
			return { beforeId: rest[index].id, index };
		}

		return { afterId: rest[rest.length - 1].id, index };
	}

	function withinList(clientY) {
		const all = rows();

		if (all.length === 0) {
			return false;
		}

		const top = Math.min(...all.map((row) => measure(row.el).top));
		const bottom = Math.max(...all.map((row) => measure(row.el).bottom));

		return clientY >= top && clientY <= bottom;
	}

	function onMove(event) {
		target.value = slotAt(event.clientY);
	}

	function onUp(event) {
		const id = draggingId.value;
		const slot = target.value;
		const inside = withinList(event.clientY);

		stop();

		// Outside the list is a change of mind, not a drop at the nearest edge.
		if (slot && inside) {
			onDrop(id, slot.index);
		}
	}

	function onKey(event) {
		if (event.key === 'Escape') {
			stop();
		}
	}

	function stop() {
		draggingId.value = null;
		target.value = null;
		origin = -1;
		window.removeEventListener('pointermove', onMove);
		window.removeEventListener('pointerup', onUp);
		window.removeEventListener('pointercancel', stop);
		document.removeEventListener('keydown', onKey);
	}

	/**
	 * The handle's `@pointerdown`. Captures the pointer so a finger that leaves
	 * the handle keeps reporting to it, and listens on `window` so the release
	 * is heard wherever it happens.
	 */
	function start(event, id) {
		// A right click is a context menu, not a drag.
		if (event.pointerType === 'mouse' && event.button !== 0) {
			return;
		}

		const index = rows().findIndex((row) => row.id === id);

		if (index === -1) {
			return;
		}

		event.preventDefault();
		// jsdom has no pointer capture; the window listeners carry the drag there.
		event.currentTarget?.setPointerCapture?.(event.pointerId);

		draggingId.value = id;
		origin = index;
		target.value = null;

		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', stop);
		document.addEventListener('keydown', onKey);
	}

	onUnmounted(stop);

	// Reactive rather than a plain object, so a template reads `drag.target`
	// as a value — refs nested in a plain object are not unwrapped.
	return reactive({ draggingId, target, start, cancel: stop });
}
