<script setup>
import { onMounted, ref } from 'vue';
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

/**
 * The store rethrows a 401 and folds everything else into `tasks.error`. Every
 * action has to catch it: the token is already gone by then, and without this
 * the user is left on a list that still looks signed in.
 */
async function guard(action) {
	try {
		await action();
	} catch {
		// These tasks belong to the account that just ended, and this device may
		// be handed to someone else.
		tasks.forget();
		await router.replace('/login');
	}
}

const refresh = () => guard(() => tasks.load());

onMounted(refresh);
useRefreshOnReturn(refresh);

async function toggle(task, event) {
	// Which way this goes is decided by the record, not by the event — a double
	// click cannot complete the same task twice.
	await guard(() => (isOpen(task) ? tasks.complete(task.id) : tasks.reopen(task.id)));

	// The browser has already flipped the box. If the write failed the record is
	// unchanged, and Vue will not patch a prop it believes is the same — so put
	// the DOM back by hand, or the row sits there claiming to be done.
	if (event.target) {
		event.target.checked = !isOpen(task);
	}
}

async function destroy() {
	const task = deleting.value;
	deleting.value = null;

	await guard(() => tasks.remove(task.id));
}
</script>

<template>
	<section class="app-view container">
		<!-- The wordmark in the nav already names this view; a second "Tasks"
			 on screen is noise. The heading stays for structure. -->
		<h1 class="visually-hidden">Tasks</h1>

		<!--
			Shown alongside the list rather than instead of it: a failed reload
			still leaves the last known tasks worth looking at.
		-->
		<p v-if="tasks.error" class="error">{{ tasks.error }}</p>

		<p v-if="tasks.loading && tasks.tasks.length === 0" class="text-muted">Loading your tasks…</p>

		<!--
			Both states are gated on a load having actually succeeded. Saying
			"no tasks yet" under a connection error would be a guess presented
			as fact.
		-->
		<p v-else-if="tasks.loaded && tasks.tasks.length === 0" class="text-muted">
			No tasks yet. Add one and it will show up here.
		</p>

		<p v-else-if="tasks.loaded && tasks.visible.length === 0" class="text-muted">
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
						@change="toggle(task, $event)"
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
