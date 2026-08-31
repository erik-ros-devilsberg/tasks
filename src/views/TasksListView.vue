<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';

import { useTasksStore } from '@/stores/tasks';
import { isOverdue } from '@/lib/taskSort';
import { formatDue } from '@/lib/formatDue';

const router = useRouter();
const tasks = useTasksStore();

async function refresh() {
	try {
		await tasks.load();
	} catch {
		// The store only rethrows a 401. The session is already cleared by then;
		// forget the tasks too — they belong to the account that just ended, and
		// this device may be handed to someone else.
		tasks.forget();
		await router.replace('/login');
	}
}

onMounted(refresh);
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

					<span v-if="task.due_at" class="list__secondary">{{ formatDue(task) }}</span>

					<!-- Overdue carries a word, not just a colour. -->
					<span v-if="isOverdue(task, tasks.now)" class="badge badge--overdue">Overdue</span>
				</li>
			</ul>
		</div>
	</section>
</template>
