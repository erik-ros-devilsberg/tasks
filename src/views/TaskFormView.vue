<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useTasksStore } from '@/stores/tasks';
import { joinDue, splitDue } from '@/lib/dueFields';
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

const fieldErrors = ref({});
const error = ref('');
const busy = ref(false);
const confirmingDelete = ref(false);
/*
 * Set when the task being edited could not be read. The form must not be
 * submittable in that state: an empty form PATCHed over a real record wipes its
 * title, notes and due date because of one transient network failure.
 */
const unloadable = ref(false);

/**
 * The store rethrows a 401. The token is already gone by then, so the only
 * useful thing left is to send the user somewhere they can sign in again —
 * showing them "Unauthenticated." on a form that can never save is not.
 */
async function endSession() {
	tasks.forget();
	await router.replace('/login');
}

onMounted(async () => {
	if (!editing.value) {
		return;
	}

	try {
		// Reads from the store when the list is already loaded, and fetches only
		// for a deep link that arrived before it.
		const task = await tasks.fetchOne(id.value);

		if (!task) {
			unloadable.value = true;
			error.value = tasks.error || 'Could not load that task.';

			return;
		}

		title.value = task.title ?? '';
		notes.value = task.notes ?? '';

		const due = splitDue(task.due_at);
		dueDate.value = due.date;
		dueTime.value = due.time;
	} catch {
		await endSession();
	}
});

/**
 * Deliberately never sends `completed_at`. The store's update is a PATCH, so
 * omitting it leaves it alone — mentioning it at all is how a completed task
 * gets silently reopened.
 */
function body() {
	return {
		title: title.value,
		notes: notes.value === '' ? null : notes.value,
		due_at: joinDue(dueDate.value, dueTime.value),
	};
}

async function submit() {
	// Never save a form that was never filled from the record.
	if (unloadable.value) {
		return;
	}

	busy.value = true;
	fieldErrors.value = {};
	error.value = '';

	try {
		const saved = editing.value
			? await tasks.update(id.value, body())
			: await tasks.create(body());

		// A null here means the store already recorded the failure; the form
		// stays put with everything the user typed still in it.
		if (saved === null && tasks.error) {
			error.value = tasks.error;

			return;
		}

		await router.push('/');
	} catch (failure) {
		if (failure.status === 422) {
			fieldErrors.value = failure.data?.errors ?? {};
		} else {
			await endSession();
		}
	} finally {
		busy.value = false;
	}
}

async function destroy() {
	confirmingDelete.value = false;

	try {
		if (await tasks.remove(id.value)) {
			await router.push('/');
		} else {
			error.value = tasks.error || 'Could not delete that task.';
		}
	} catch {
		await endSession();
	}
}
</script>

<template>
	<section class="app-view container">
		<h1>{{ editing ? 'Edit task' : 'New task' }}</h1>

		<form class="form" @submit.prevent="submit">
			<div class="field">
				<label for="title">Title</label>
				<input id="title" v-model="title" name="title" type="text" maxlength="255" />
				<p v-if="fieldErrors.title" class="field__error">{{ fieldErrors.title[0] }}</p>
			</div>

			<div class="field">
				<label for="notes">Notes</label>
				<textarea id="notes" v-model="notes" name="notes"></textarea>
				<p v-if="fieldErrors.notes" class="field__error">{{ fieldErrors.notes[0] }}</p>
			</div>

			<!--
				A date input, not a datetime-local: "this day, no particular time"
				is the answer this form gives, and datetime-local cannot express it.
			-->
			<div class="field">
				<label for="due_date">Due</label>
				<input id="due_date" v-model="dueDate" name="due_date" type="date" />

				<p v-if="fieldErrors.due_at" class="field__error">{{ fieldErrors.due_at[0] }}</p>
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
