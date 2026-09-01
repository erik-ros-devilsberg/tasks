<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useTasksStore } from '@/stores/tasks';
import { joinDue, splitDue } from '@/lib/dueFields';
import { formatDuration, parseDuration } from '@/lib/durationField';
import ConfirmModal from '@/components/ConfirmModal.vue';

const route = useRoute();
const router = useRouter();
const tasks = useTasksStore();

const id = computed(() => route.params.id ?? null);
const editing = computed(() => id.value !== null);

const title = ref('');
const notes = ref('');
const dueDate = ref('');
/*
 * Not a field any more — the form registers a day, not a time of day. It is
 * still read off the record and sent back so that editing a task registered as
 * "Friday at 14:30" does not quietly demote it to "Friday, some time".
 */
const dueTime = ref('');
// Minutes, as text. Kept as the raw field value rather than a number so that a
// half-typed entry is never silently rewritten under the user's cursor.
const duration = ref('');

const error = ref('');
const busy = ref(false);
const confirmingDelete = ref(false);
/*
 * Set when the task being edited could not be found. The form must not be
 * submittable in that state: an empty form saved over a real record wipes its
 * title, notes, duration and due date.
 */
const unloadable = ref(false);

onMounted(async () => {
	if (!editing.value) {
		return;
	}

	// Reads from the device, and syncs only for a deep link that arrived before
	// this browser had ever seen the list.
	const task = await tasks.fetchOne(id.value);

	if (!task) {
		unloadable.value = true;
		error.value = 'Could not find that task.';

		return;
	}

	title.value = task.title ?? '';
	notes.value = task.notes ?? '';
	duration.value = formatDuration(task.duration);

	const due = splitDue(task.due_at);
	dueDate.value = due.date;
	dueTime.value = due.time;
});

/**
 * Deliberately never sends `completed_at`. Completion has its own two
 * operations; letting it into an edit is how a finished task gets silently
 * reopened.
 */
function body() {
	return {
		title: title.value,
		notes: notes.value === '' ? null : notes.value,
		due_at: joinDue(dueDate.value, dueTime.value),
		// Always present, never omitted: an absent key leaves a PATCH field
		// untouched, so clearing the box has to send an explicit null.
		duration: parseDuration(duration.value),
	};
}

async function submit() {
	// Never save a form that was never filled from the record.
	if (unloadable.value) {
		return;
	}

	busy.value = true;
	error.value = '';

	try {
		// Saved on the device, so this cannot fail for want of a connection. The
		// server hears about it on the next sync.
		if (editing.value) {
			await tasks.update(id.value, body());
		} else {
			await tasks.create(body());
		}

		await router.push('/');
	} finally {
		busy.value = false;
	}
}

async function destroy() {
	confirmingDelete.value = false;

	await tasks.remove(id.value);
	await router.push('/');
}
</script>

<template>
	<section class="app-view container">
		<h1>{{ editing ? 'Edit task' : 'New task' }}</h1>

		<form class="form" @submit.prevent="submit">
			<div class="field">
				<label for="title">Title</label>
				<input id="title" v-model="title" name="title" type="text" maxlength="255" />
			</div>

			<div class="field">
				<label for="notes">Notes</label>
				<textarea id="notes" v-model="notes" name="notes"></textarea>
			</div>

			<!--
				An estimate, so the box is left empty rather than defaulted to a
				number nobody chose. `step="5"` only sets what the spinner jumps by
				— any whole number of minutes is still accepted.
			-->
			<div class="field">
				<label for="duration">Duration</label>
				<input
					id="duration"
					v-model="duration"
					name="duration"
					type="number"
					min="0"
					step="5"
					inputmode="numeric"
					aria-describedby="duration-unit"
				/>
				<p id="duration-unit" class="text-meta">Minutes</p>
			</div>

			<!--
				A date input, not a datetime-local: "this day, no particular time"
				is the answer this form gives, and datetime-local cannot express it.
			-->
			<div class="field">
				<label for="due_date">Due</label>
				<input id="due_date" v-model="dueDate" name="due_date" type="date" />
			</div>

			<p v-if="error" class="error">{{ error }}</p>

			<div class="form__actions">
				<button class="btn btn--primary" type="submit" :disabled="busy || unloadable">
					{{ busy ? 'Saving' : 'Save' }}
				</button>

				<button class="btn btn--ghost" type="button" @click="router.push('/')">Cancel</button>

				<button
					v-if="editing"
					class="btn btn--danger"
					type="button"
					data-action="delete"
					@click="confirmingDelete = true"
				>
					Delete
				</button>
			</div>
		</form>

		<ConfirmModal
			v-if="confirmingDelete"
			:title="`Delete “${title}”?`"
			body="This cannot be undone."
			confirm-label="Delete"
			@confirm="destroy"
			@cancel="confirmingDelete = false"
		/>
	</section>
</template>
