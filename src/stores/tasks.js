import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';

import { createKv, memoryKv } from '@/lib/kv';
import { createOfflineStore } from '@/lib/offlineStore';
import { createTasksRemote } from '@/lib/tasksRemote';
import { isCompleted, isOpen, listTasks, sortCompleted } from '@/lib/taskSort';
import { readCompletedShown, writeCompletedShown } from '@/lib/completedPreference';
import { useSessionStore } from '@/stores/session';

/*
 * One database, two object stores: the tasks themselves and the queue of writes
 * waiting to reach the server. Its own name keeps it clear of the sibling apps
 * sharing an origin.
 */
const DB = 'coevta-tasks';

/*
 * The durable store is injected rather than imported. That is the seam that
 * keeps tests fast and storage-free: tests hand this a fake, main.js installs
 * the real IndexedDB-backed one at boot.
 */
let offline = null;

export function useOfflineStore(value) {
	offline = value;

	return offline;
}

/**
 * The same seam, entered one layer lower: a test that only wants to control
 * what the server says gets the real durable layer over throwaway memory.
 */
export function useRemote(remote) {
	return useOfflineStore(
		createOfflineStore({ kv: memoryKv(), outboxKv: memoryKv(), remote }),
	);
}

export function createTasksOfflineStore() {
	const session = useSessionStore();

	return createOfflineStore({
		kv: createKv(DB, 'tasks'),
		outboxKv: createKv(DB, 'outbox'),
		remote: createTasksRemote({ api: session.api }),
		onUnauthorized: () => {
			session.setToken(null);
		},
	});
}

export const useTasksStore = defineStore('tasks', () => {
	const tasks = ref([]);
	// Starts true: nothing has been read yet, and starting false would flash
	// "no tasks yet" at the user for one frame before the first read resolves.
	const loading = ref(true);
	// Set once the device has been read. Unlike the online version this is not a
	// question of whether the server answered — it always resolves, so an empty
	// list is a fact rather than a guess.
	const loaded = ref(false);
	const syncing = ref(false);
	// Hard problems the user may need to act on: a change the server refused,
	// or a server that answered with something other than the list. Losing a
	// connection is not one of these — see `syncNow`.
	const error = ref('');
	const unauthorized = ref(false);
	/*
	 * Whether the server has ever answered on this device. The device always
	 * answers, so an empty cache is only a fact once we have heard from the
	 * server — before that it is a guess, and "no tasks yet" would be a lie to
	 * someone whose first ever launch happened to be offline.
	 */
	const synced = ref(false);
	const pendingCount = ref(0);
	const pendingIds = ref([]);

	/*
	 * The clock every row's state is measured against, refreshed on every read.
	 * It is state rather than a `new Date()` read per row so that two rows
	 * rendered in the same pass cannot disagree about where "today" ends.
	 */
	const now = ref(new Date());

	/*
	 * A display preference rather than server state, but it lives here because
	 * two places need the same answer: the nav menu that toggles it and the list
	 * that renders it.
	 */
	const completedShown = ref(readCompletedShown());
	watch(completedShown, writeCompletedShown);

	const open = computed(() => tasks.value.filter(isOpen));
	const completed = computed(() => sortCompleted(tasks.value.filter(isCompleted)));
	// One flat list — completed tasks mixed in by the same ordering rule, not
	// pushed into a section of their own.
	const visible = computed(() => listTasks(tasks.value, { completed: completedShown.value }));

	const isPending = (id) => pendingIds.value.includes(id);

	function store() {
		if (!offline) {
			offline = createTasksOfflineStore();
		}

		return offline;
	}

	async function readPending() {
		pendingCount.value = await store().pendingCount();
		pendingIds.value = await store().pendingIds();
	}

	async function readLocal() {
		tasks.value = await store().cached();
		now.value = new Date();
		await readPending();
	}

	async function load() {
		await readLocal();
		loaded.value = true;
		loading.value = false;
	}

	/**
	 * Push local work first, then pull. The other order would refresh away an
	 * edit that has not left the device yet.
	 *
	 * Returns whether it got through, so a caller can decide to try again. It
	 * never throws and never reports a transport failure: see the catch.
	 */
	async function syncNow() {
		syncing.value = true;

		try {
			const result = await store().flush();

			if (result.rejected.length) {
				// The user made these edits. Losing them quietly would be worse
				// than saying so.
				error.value = `${result.rejected.length} change${
					result.rejected.length === 1 ? '' : 's'
				} could not be saved and ${result.rejected.length === 1 ? 'was' : 'were'} dropped.`;
			}

			const refreshed = await store().refresh();

			// null means 401: an expired session is not a connection problem and
			// must not be reported as one.
			if (refreshed === null) {
				unauthorized.value = true;

				return false;
			}

			/*
			 * Cleared here rather than on the way in: a sync runs on every save
			 * and every return to the tab, and clearing up front would wipe the
			 * "changes were dropped" message a second later, which is the one
			 * message the user most needs to see.
			 */
			if (!result.rejected.length) {
				error.value = '';
			}

			synced.value = true;

			return true;
		} catch {
			/*
			 * A sync that does not get through is never the user's problem.
			 *
			 * There is no useful distinction to draw here for them. The device may
			 * be in a tunnel, the server may be restarting, a proxy may be
			 * answering 502 on its behalf — and in development Vite's own proxy
			 * answers 500 when the backend is not running. All of it means the
			 * same thing: not now, try later. The work is on the device, the queue
			 * is durable and ordered, and `useRetryingSync` keeps attempting until
			 * it lands.
			 *
			 * The one failure worth reporting is a change the server actively
			 * refused and dropped, which is not this path — that is `rejected`
			 * above, and it is about losing the user's own work rather than about
			 * the state of the network.
			 */
			return false;
		} finally {
			await readLocal();
			loaded.value = true;
			loading.value = false;
			syncing.value = false;
		}
	}

	/**
	 * One task, for a deep link into the form. Prefers what is already held —
	 * a task opened from the list should not cost anything — and syncs only for
	 * a link that arrived before this device had ever read the list.
	 */
	async function fetchOne(id) {
		const held = tasks.value.find((task) => task.id === id) ?? (await store().get(id));

		if (held) {
			return held;
		}

		await syncNow();

		return tasks.value.find((task) => task.id === id) ?? null;
	}

	async function create(body) {
		const record = await store().create(body);

		await readLocal();

		return record;
	}

	async function update(id, body) {
		const record = await store().update(id, body);

		await readLocal();

		return record;
	}

	async function complete(id) {
		const record = await store().complete(id);

		await readLocal();

		return record;
	}

	async function reopen(id) {
		const record = await store().reopen(id);

		await readLocal();

		return record;
	}

	async function remove(id) {
		await store().remove(id);

		await readLocal();

		return true;
	}

	/**
	 * Every delete lands on the device before the list is re-read, so the
	 * caller's one `syncNow()` afterwards finds the whole batch already queued —
	 * a sync started between two of them would push half a decision.
	 */
	async function removeMany(ids) {
		for (const id of ids) {
			await store().remove(id);
		}

		await readLocal();

		return true;
	}

	/**
	 * Empties everything, cache and queue alike. Called when a session ends:
	 * this device is shared, and without it the next person to sign in reads the
	 * previous account's tasks straight off the disk.
	 */
	async function forget() {
		await store().clear();

		tasks.value = [];
		loaded.value = false;
		loading.value = true;
		error.value = '';
		synced.value = false;
		unauthorized.value = false;
		await readPending();
	}

	return {
		tasks,
		loading,
		loaded,
		syncing,
		error,
		synced,
		unauthorized,
		pendingCount,
		pendingIds,
		isPending,
		now,
		open,
		completed,
		visible,
		completedShown,
		forget,
		load,
		syncNow,
		fetchOne,
		create,
		update,
		complete,
		reopen,
		remove,
		removeMany,
	};
});
