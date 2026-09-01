<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useTasksStore } from '@/stores/tasks';
import { useRefreshOnReturn } from '@/composables/useRefreshOnReturn';
import { isOpen, stateOf } from '@/lib/taskSort';
import ConfirmModal from '@/components/ConfirmModal.vue';

const router = useRouter();
const tasks = useTasksStore();

const deleting = ref(null);

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
	// network — then the network, to catch up.
	await tasks.load();
	await tasks.syncNow();
});

useRefreshOnReturn(() => tasks.syncNow());

// A connection coming back is the one moment a queue can finally be drained.
const drain = () => tasks.syncNow();

onMounted(() => window.addEventListener('online', drain));
onUnmounted(() => window.removeEventListener('online', drain));

async function toggle(task) {
	// Which way this goes is decided by the record, not by the event — a double
	// click cannot complete the same task twice.
	await (isOpen(task) ? tasks.complete(task.id) : tasks.reopen(task.id));

	// Saved on the device already; this only pushes it onwards. Offline it is a
	// no-op that leaves the change safely queued.
	await tasks.syncNow();
}

async function destroy() {
	const task = deleting.value;
	deleting.value = null;

	await tasks.remove(task.id);
	await tasks.syncNow();
}
</script>

<template>
	<section class="app-view container">
		<!-- The wordmark in the nav already names this view; a second "Tasks"
			 on screen is noise. The heading stays for structure. -->
		<h1 class="visually-hidden">Tasks</h1>

		<!--
			Shown alongside the list rather than instead of it: a change the server
			refused still leaves the rest of the list worth looking at.
		-->
		<p v-if="tasks.error" class="error">{{ tasks.error }}</p>

		<!--
			A sync that could not get through is not a fault the user caused, and
			the list underneath is still worth reading — so it is a notice beside
			the tasks rather than an error in place of them.
		-->
		<p v-if="tasks.notice" class="notice">{{ tasks.notice }}</p>

		<p v-if="tasks.loading && tasks.tasks.length === 0" class="text-muted">Loading your tasks…</p>

		<!--
			Gated on the sync having got through. The device always answers, so an
			empty cache is a fact once we have heard from the server — but on a
			device that has never managed a sync it is a guess, and saying "no
			tasks yet" next to "no connection" tells the user two contradictory
			things.
		-->
		<p v-else-if="tasks.loaded && tasks.tasks.length === 0 && !tasks.notice" class="text-muted">
			No tasks yet. Add one and it will show up here.
		</p>

		<p v-else-if="tasks.loaded && tasks.tasks.length > 0 && tasks.visible.length === 0" class="text-muted">
			Nothing open. Everything here is done.
		</p>

		<!-- One list, no headings: the background colour says what a group label used to. -->
		<div class="list">
			<ul>
				<li
					v-for="task in tasks.visible"
					:key="task.id"
					class="list__row"
					:class="`list__row--${stateOf(task, tasks.now)}`"
				>
					<input
						type="checkbox"
						:checked="!isOpen(task)"
						:aria-label="`${isOpen(task) ? 'Complete' : 'Reopen'} ${task.title}`"
						@change="toggle(task)"
					/>

					<button
						class="list__primary"
						type="button"
						data-action="open"
						@click="router.push(`/tasks/${task.id}/edit`)"
					>
						{{ task.title }}
						<span class="visually-hidden">{{ STATE_WORDS[stateOf(task, tasks.now)] }}</span>
					</button>

					<!--
						Not a warning — the change is saved. It says only that the
						server has not been told yet, which is why the same task may
						look different on another device for now.
					-->
					<span v-if="tasks.isPending(task.id)" class="badge badge--pending" data-state="pending">
						Not synced
					</span>

					<button
						class="btn btn--ghost btn--icon btn--sm"
						type="button"
						data-action="delete"
						:aria-label="`Delete ${task.title}`"
						@click="deleting = task"
					>
						<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
							<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13M10 11v6M14 11v6" />
						</svg>
					</button>
				</li>
			</ul>
		</div>

		<!--
			Pinned to the bottom rather than sat in a toolbar: on a phone this is
			the one control worth putting under the thumb, and it stays reachable
			however far down the list the user has scrolled.
		-->
		<button
			class="btn btn--primary btn--icon btn--fab"
			type="button"
			data-action="new-task"
			aria-label="New task"
			@click="router.push('/tasks/new')"
		>
			<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
				<path d="M12 5v14M5 12h14" />
			</svg>
		</button>

		<ConfirmModal
			v-if="deleting"
			:title="`Delete “${deleting.title}”?`"
			body="This cannot be undone."
			confirm-label="Delete"
			@confirm="destroy"
			@cancel="deleting = null"
		/>
	</section>
</template>
