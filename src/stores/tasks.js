import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import { groupOpen, isCompleted, isOpen, sortCompleted } from '@/lib/taskSort';

/*
 * The remote is injected rather than imported. That is the seam that keeps view
 * tests fast and network-free: tests hand this a fake, main.js installs the
 * real one at boot.
 */
let remote = null;

export function useRemote(value) {
	remote = value;
}

/**
 * A 401 means the session is gone, and only the session layer can act on that.
 * Every action rethrows it instead of folding it into `error`.
 */
function isUnauthorized(failure) {
	return failure?.status === 401;
}

/**
 * A 422 names the fields it rejected, and only the form showing those fields
 * can act on that. Folding it into a general error message would strip the
 * detail and leave the user guessing which field was wrong.
 */
function isValidation(failure) {
	return failure?.status === 422;
}

export const useTasksStore = defineStore('tasks', () => {
	const tasks = ref([]);
	// Starts true: nothing has been loaded yet, and starting false would flash
	// "no tasks yet" at the user for one frame before the first load resolves.
	const loading = ref(true);
	// Distinguishes "the account has no tasks" from "we never got an answer" —
	// otherwise a failed first load renders an empty state that is a guess.
	const loaded = ref(false);
	const error = ref('');

	/*
	 * The clock the buckets are measured against, refreshed on every load. It is
	 * state rather than a `new Date()` inside the computed so that the grouping
	 * and the per-row overdue marker cannot disagree — a row must never carry an
	 * "Overdue" badge while sitting under the "Today" heading.
	 */
	const now = ref(new Date());

	/*
	 * Bumped by every load and by forget(). A response whose ticket is stale has
	 * been overtaken and is dropped: without this, a slow first request landing
	 * after a fast second one would put the older list back on screen.
	 */
	let generation = 0;

	const open = computed(() => tasks.value.filter(isOpen));
	const completed = computed(() => sortCompleted(tasks.value.filter(isCompleted)));
	const groups = computed(() => groupOpen(tasks.value, now.value));

	function replaceLocal(task) {
		const at = tasks.value.findIndex((held) => held.id === task.id);

		if (at === -1) {
			tasks.value = [...tasks.value, task];
		} else {
			tasks.value = tasks.value.map((held) => (held.id === task.id ? task : held));
		}
	}

	/**
	 * Empties the store. Called when a session ends: this device is shared, and
	 * without it the next person to sign in sees the previous account's tasks
	 * rendered from memory until their own load resolves.
	 */
	function forget() {
		generation += 1;
		tasks.value = [];
		loaded.value = false;
		loading.value = true;
		error.value = '';
	}

	async function load() {
		const ticket = (generation += 1);
		loading.value = true;

		try {
			const list = await remote.listAll();

			if (ticket !== generation) {
				return;
			}

			tasks.value = list;
			now.value = new Date();
			loaded.value = true;
			error.value = '';
		} catch (failure) {
			if (isUnauthorized(failure)) {
				throw failure;
			}

			if (ticket !== generation) {
				return;
			}

			// Deliberately not clearing `tasks`: showing the last known list with
			// a warning beats showing an empty screen. On a first load there is
			// nothing to show, so the message must not claim otherwise.
			error.value = loaded.value
				? 'Could not reach the server. Showing the tasks I last loaded.'
				: 'Could not reach the server.';
		} finally {
			if (ticket === generation) {
				loading.value = false;
			}
		}
	}

	/**
	 * Runs a write, converting any failure into a message the views can show.
	 * Returns whether it succeeded — separately from what it returned, because
	 * an empty 204 body is a success that looks exactly like a failure.
	 */
	async function attempt(action, message, { surfaceValidation = false } = {}) {
		try {
			error.value = '';

			return { ok: true, value: await action() };
		} catch (failure) {
			// Only the form asks for validation errors, because only the form has
			// fields to hang them on. Rethrowing to a checkbox handler would give
			// an unhandled rejection and a click that does nothing.
			if (isUnauthorized(failure) || (surfaceValidation && isValidation(failure))) {
				throw failure;
			}

			error.value = message;

			return { ok: false, value: null };
		}
	}

	/**
	 * Applies the record the server returned. If it answered without one, the
	 * new state is unknown — ask for it rather than guess, or the user clicks
	 * and watches nothing happen.
	 */
	async function applyResult({ ok, value }) {
		if (!ok) {
			return null;
		}

		if (value) {
			replaceLocal(value);

			return value;
		}

		await load();

		return null;
	}

	/**
	 * One task, for a deep link into the form before the list has loaded.
	 * Prefers what is already held — a task opened from the list should not
	 * cost a request.
	 */
	async function fetchOne(id) {
		const held = tasks.value.find((task) => task.id === id);

		if (held) {
			return held;
		}

		const { value } = await attempt(() => remote.get(id), 'Could not load that task.');

		if (value) {
			replaceLocal(value);
		}

		return value;
	}

	async function create(body) {
		return applyResult(
			await attempt(() => remote.create(body), 'Could not save that task.', {
				surfaceValidation: true,
			}),
		);
	}

	async function update(id, body) {
		return applyResult(
			await attempt(() => remote.update(id, body), 'Could not save that change.', {
				surfaceValidation: true,
			}),
		);
	}

	async function complete(id) {
		// The server stamps completed_at, so the record it returns is the truth —
		// guessing the timestamp here would put the row in the wrong order.
		return applyResult(await attempt(() => remote.complete(id), 'Could not complete that task.'));
	}

	async function reopen(id) {
		return applyResult(await attempt(() => remote.reopen(id), 'Could not reopen that task.'));
	}

	async function remove(id) {
		const { ok } = await attempt(() => remote.remove(id), 'Could not delete that task.');

		if (ok) {
			// Filtered after the await, not before: a refresh that landed during
			// the round-trip would otherwise be silently rolled back.
			tasks.value = tasks.value.filter((task) => task.id !== id);
		}

		return ok;
	}

	return {
		tasks,
		loading,
		loaded,
		error,
		now,
		open,
		completed,
		groups,
		forget,
		load,
		fetchOne,
		create,
		update,
		complete,
		reopen,
		remove,
	};
});
