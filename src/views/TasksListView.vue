<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useTasksStore } from '@/stores/tasks';
import { useRefreshOnReturn } from '@/composables/useRefreshOnReturn';
import { useRetryingSync } from '@/composables/useRetryingSync';
import { useDragReorder } from '@/composables/useDragReorder';
import { isOpen, stateOf } from '@/lib/taskSort';
import ConfirmModal from '@/components/ConfirmModal.vue';

const router = useRouter();
const route = useRoute();
const tasks = useTasksStore();

/*
 * Delete mode is read off the route rather than held here, so the back
 * button, a menu choice and a plain link all leave it the same way. What is
 * selected is local: it dies with the mode, never outlives a navigation.
 */
const deleteMode = computed(() => route.query.mode === 'delete');
const selected = ref(new Set());
const confirming = ref(false);

watch(deleteMode, () => {
	selected.value = new Set();
	confirming.value = false;
});

const selectedCount = computed(() => selected.value.size);

/*
 * Each row's element, by task id, so a drag can measure the rows it is moving
 * among. The map, not a `v-for` ref array: a ref array follows DOM order, and
 * what a drop needs is the rows in the *store's* open order, completed rows
 * left out — `tasks.open` is that list, and it is the index space the store
 * measures the drop in.
 */
const rowEls = new Map();

function setRowEl(id, el) {
	if (el) {
		rowEls.set(id, el);
	} else {
		rowEls.delete(id);
	}
}

const drag = useDragReorder({
	rows: () => tasks.open.map((task) => ({ id: task.id, el: rowEls.get(task.id) })).filter((row) => row.el),
	measure: (el) => {
		const { top, bottom } = el.getBoundingClientRect();

		return { top, bottom };
	},
	onDrop: (id, index) => tasks.reorder(id, index),
});

const dragClasses = (task) => ({
	'is-dragging': drag.draggingId === task.id,
	'is-drop-before': drag.target?.beforeId === task.id,
	'is-drop-after': drag.target?.afterId === task.id,
});

/*
 * The row's state is signalled by its background colour, and colour is never
 * the only carrier — this is the word a screen reader reads instead.
 */
const STATE_WORDS = {
	overdue: 'Overdue',
	today: 'Due today',
	upcoming: 'Due later',
	undated: 'No due date',
	completed: 'Completed',
};

onMounted(async () => {
	// The device first, so the list is on screen before anything touches the
	// network. `useRetryingSync` does the catching up.
	await tasks.load();
});

/*
 * Syncs on mount and then keeps trying for as long as it fails. A server that
 * is down, a proxy answering on its behalf, a phone in a tunnel — the app waits
 * it out by itself rather than handing the user a problem they cannot solve.
 */
useRetryingSync(() => tasks.syncNow());

useRefreshOnReturn(() => tasks.syncNow());

// A connection coming back is the one moment a queue can finally be drained.
const drain = () => tasks.syncNow();

onMounted(() => window.addEventListener('online', drain));
onUnmounted(() => window.removeEventListener('online', drain));

async function toggle(task) {
	// In delete mode the tick is only a target for selection; the row's click
	// handler has already dealt with it.
	if (deleteMode.value) {
		return;
	}

	// Which way this goes is decided by the record, not by the event — a double
	// click cannot complete the same task twice.
	await (isOpen(task) ? tasks.complete(task.id) : tasks.reopen(task.id));

	// Saved on the device already; this only pushes it onwards. Offline it is a
	// no-op that leaves the change safely queued.
	await tasks.syncNow();
}

function open(task) {
	if (deleteMode.value) {
		return;
	}
	router.push(`/tasks/${task.id}/edit`);
}

/*
 * Anywhere on the row toggles selection. The name and the tick inside it are
 * made inert above rather than stopped here, so the one click still reaches
 * this handler whichever part of the row it landed on.
 */
function select(task) {
	if (!deleteMode.value) {
		return;
	}

	const next = new Set(selected.value);
	if (next.has(task.id)) {
		next.delete(task.id);
	} else {
		next.add(task.id);
	}
	selected.value = next;
}

function leaveDeleteMode() {
	router.replace({ query: {} });
}

async function destroySelected() {
	const ids = [...selected.value];
	confirming.value = false;

	// The whole batch lands on the device before the one sync, so a drain can
	// never carry half of it.
	await tasks.removeMany(ids);
	leaveDeleteMode();
	await tasks.syncNow();
}
</script>

<template>
	<section class="container" @keydown.esc="deleteMode && !confirming && leaveDeleteMode()">
		<!-- The wordmark in the nav already names this view; a second "Tasks"
			 on screen is noise. The heading stays for structure. -->
		<h1 class="visually-hidden">Tasks</h1>

		<!--
			Shown alongside the list rather than instead of it: a change the server
			refused still leaves the rest of the list worth looking at.
		-->
		<p v-if="tasks.error" class="error">{{ tasks.error }}</p>

		<p v-if="tasks.loading && tasks.tasks.length === 0" class="text-muted">Loading your tasks…</p>

		<!--
			Gated on the sync having got through. The device always answers, so an
			empty cache is a fact once we have heard from the server — but on a
			device that has never managed a sync it is a guess, and telling someone
			whose first launch happened to be offline that they have no tasks is a
			lie they cannot check.
		-->
		<p v-else-if="tasks.loaded && tasks.synced && tasks.tasks.length === 0" class="text-muted">
			No tasks yet. Add one and it will show up here.
		</p>

		<p v-else-if="tasks.loaded && tasks.tasks.length > 0 && tasks.visible.length === 0" class="text-muted">
			Nothing open. Everything here is done.
		</p>

		<!-- One list, no headings: the background colour says what a group label used to. -->
		<ul class="list" :class="{ 'is-delete-mode': deleteMode }">
			<li
				v-for="task in tasks.visible"
				:key="task.id"
				:ref="(el) => setRowEl(task.id, el)"
				class="list__row"
				:class="[
					`list__row--${stateOf(task, tasks.now)}`,
					{ 'is-selected': selected.has(task.id) },
					dragClasses(task),
				]"
				:aria-selected="deleteMode ? String(selected.has(task.id)) : undefined"
				@click="select(task)"
			>
				<!--
					Disabled in delete mode: completing is not on offer while the
					mode is about deleting, and a live box next to a selection is an
					invitation to lose a task to a mis-tap. A disabled control is
					not a hit target, so the CSS also hands its clicks to the row —
					otherwise the tick would be a dead patch in the middle of it.
					The cancelled click stays as the belt to that braces: whatever
					reaches the box, it never flips and claims a task was done.
				-->
				<input
					class="tick"
					type="checkbox"
					:checked="!isOpen(task)"
					:disabled="deleteMode"
					:aria-label="`${isOpen(task) ? 'Complete' : 'Reopen'} ${task.title}`"
					@click="deleteMode && $event.preventDefault()"
					@change="toggle(task)"
				/>

				<button
					class="list__primary"
					type="button"
					data-action="open"
					@click="open(task)"
				>
					{{ task.title }}
					<span class="visually-hidden">{{ STATE_WORDS[stateOf(task, tasks.now)] }}</span>
					<span v-if="selected.has(task.id)" class="visually-hidden">Selected</span>
				</button>

				<!--
					Not a warning — the change is saved. It says only that the
					server has not been told yet, which is why the same task may
					look different on another device for now.
				-->
				<span v-if="tasks.isPending(task.id)" class="badge badge--pending" data-state="pending">
					Not synced
				</span>

				<!--
					The one part of the row that starts a drag; the name and the
					tick keep their jobs. Open rows only — a completed task has no
					position — and never in delete mode, where a press means select.
					Its click is stopped so the row does not take it for a select
					if the mode flips mid-press. Keyboard reordering is a later story.
				-->
				<button
					v-if="isOpen(task) && !deleteMode"
					class="list__handle"
					type="button"
					data-action="reorder"
					:aria-label="`Reorder ${task.title}`"
					@pointerdown="drag.start($event, task.id)"
					@click.stop
				>
					<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
						<circle cx="9" cy="6" r="1.6" />
						<circle cx="15" cy="6" r="1.6" />
						<circle cx="9" cy="12" r="1.6" />
						<circle cx="15" cy="12" r="1.6" />
						<circle cx="9" cy="18" r="1.6" />
						<circle cx="15" cy="18" r="1.6" />
					</svg>
				</button>
			</li>
		</ul>

		<!--
			Pinned to the bottom rather than sat in a toolbar: on a phone this is
			the one control worth putting under the thumb, and it stays reachable
			however far down the list the user has scrolled.
		-->
		<button
			v-if="!deleteMode"
			class="btn btn--primary btn--icon btn--fab"
			type="button"
			data-action="new-task"
			aria-label="New task"
			@click="router.push('/tasks/new')"
		>
			<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
				<path d="M12 5v14M5 12h14" />
			</svg>
		</button>

		<!--
			Takes the FAB's place: in delete mode the one thing worth a thumb is
			finishing or abandoning the selection. One Delete for the whole batch,
			one confirmation, and the mode is over.
		-->
		<div v-if="deleteMode" class="actionbar" role="toolbar" aria-label="Delete tasks">
			<span class="actionbar__count" aria-live="polite">{{ selectedCount }} selected</span>
			<button class="btn btn--ghost" type="button" data-action="cancel-delete" @click="leaveDeleteMode">
				Cancel
			</button>
			<button
				class="btn btn--danger"
				type="button"
				data-action="delete-selected"
				:disabled="selectedCount === 0"
				@click="confirming = true"
			>
				Delete
			</button>
		</div>

		<ConfirmModal
			v-if="confirming"
			:title="`Delete ${selectedCount} ${selectedCount === 1 ? 'task' : 'tasks'}?`"
			body="This cannot be undone."
			confirm-label="Delete"
			@confirm="destroySelected"
			@cancel="confirming = false"
		/>
	</section>
</template>
