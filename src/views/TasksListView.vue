<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useTasksStore } from '@/stores/tasks';
import { useCompletedShown } from '@/composables/useCompletedShown';
import { isOpen, isOverdue } from '@/lib/taskSort';
import { formatDue } from '@/lib/formatDue';
import ConfirmModal from '@/components/ConfirmModal.vue';

const router = useRouter();
const tasks = useTasksStore();
const completedShown = useCompletedShown();

const deleting = ref(null);

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

const completedOn = (task) =>
	new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(
		new Date(task.completed_at),
	);
</script>

<template>
	<section class="app-view container">
		<div class="toolbar">
			<h1>Tasks</h1>

			<div class="toolbar__actions">
				<button
					class="btn btn--ghost btn--sm"
					type="button"
					data-action="refresh"
					:disabled="tasks.loading"
					@click="refresh"
				>
					Refresh
				</button>

				<button
					class="btn btn--ghost btn--sm"
					type="button"
					data-action="toggle-completed"
					@click="completedShown = !completedShown"
				>
					{{ completedShown ? 'Hide completed' : 'Show completed' }}
				</button>

				<button
					class="btn btn--primary btn--sm"
					type="button"
					data-action="new-task"
					@click="router.push('/tasks/new')"
				>
					New task
				</button>
			</div>
		</div>

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

		<p v-else-if="tasks.loaded && tasks.groups.length === 0" class="text-muted">
			Nothing open. Everything here is done.
		</p>

		<div v-for="group in tasks.groups" :key="group.key" class="list">
			<h2 class="list__header">{{ group.label }}</h2>

			<ul>
				<li
					v-for="task in group.tasks"
					:key="task.id"
					class="list__row"
					:class="{ 'is-overdue': isOverdue(task, tasks.now) }"
				>
					<input
						type="checkbox"
						:checked="!isOpen(task)"
						:aria-label="`Complete ${task.title}`"
						@change="toggle(task, $event)"
					/>

					<span class="list__primary">
						{{ task.title }}

						<!-- An indicator, not the note: a long note would wreck the row. -->
						<span
							v-if="task.notes"
							class="text-muted"
							data-role="has-notes"
							title="This task has notes"
							>·notes</span
						>
					</span>

					<span v-if="task.due_at" class="list__secondary">{{ formatDue(task, tasks.now) }}</span>

					<!-- Overdue carries a word, not just a colour. -->
					<span v-if="isOverdue(task, tasks.now)" class="badge badge--overdue">Overdue</span>

					<button
						class="btn btn--ghost btn--sm"
						type="button"
						data-action="edit"
						:aria-label="`Edit ${task.title}`"
						@click="router.push(`/tasks/${task.id}/edit`)"
					>
						Edit
					</button>

					<button
						class="btn btn--ghost btn--sm"
						type="button"
						data-action="delete"
						:aria-label="`Delete ${task.title}`"
						@click="deleting = task"
					>
						Delete
					</button>
				</li>
			</ul>
		</div>

		<div v-if="completedShown" class="list mt-2" data-section="completed">
			<h2 class="list__header">Completed</h2>

			<p v-if="tasks.completed.length === 0" class="text-muted">Nothing completed yet.</p>

			<ul>
				<li v-for="task in tasks.completed" :key="task.id" class="list__row">
					<input
						type="checkbox"
						:checked="!isOpen(task)"
						:aria-label="`Reopen ${task.title}`"
						@change="toggle(task, $event)"
					/>

					<span class="list__primary text-muted">{{ task.title }}</span>

					<span class="list__secondary">{{ completedOn(task) }}</span>

					<!-- Completed is stated, not just greyed out. -->
					<span class="badge">Done</span>

					<button
						class="btn btn--ghost btn--sm"
						type="button"
						data-action="edit"
						:aria-label="`Edit ${task.title}`"
						@click="router.push(`/tasks/${task.id}/edit`)"
					>
						Edit
					</button>

					<button
						class="btn btn--ghost btn--sm"
						type="button"
						data-action="delete"
						:aria-label="`Delete ${task.title}`"
						@click="deleting = task"
					>
						Delete
					</button>
				</li>
			</ul>
		</div>

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
