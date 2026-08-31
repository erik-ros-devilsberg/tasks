<script setup>
import { onMounted, onUnmounted, ref } from 'vue';

defineProps({
	title: { type: String, required: true },
	body: { type: String, default: '' },
	confirmLabel: { type: String, default: 'Confirm' },
});

const emit = defineEmits(['confirm', 'cancel']);

const cancelButton = ref(null);
const confirmButton = ref(null);

let previouslyFocused = null;

/**
 * Two focusable elements, so the trap is a swap rather than a general-purpose
 * ring. Anything more elaborate would be machinery this dialog does not need.
 */
function trap(event) {
	event.preventDefault();

	const target =
		document.activeElement === cancelButton.value ? confirmButton.value : cancelButton.value;

	target?.focus();
}

onMounted(() => {
	previouslyFocused = document.activeElement;
	// Cancel, not confirm: this dialog only appears for actions that cannot be
	// undone, so the safe option is the one under the user's hands.
	cancelButton.value?.focus();
});

onUnmounted(() => {
	// Without this the keyboard user is dumped back at the top of the document.
	previouslyFocused?.focus?.();
});
</script>

<template>
	<div class="modal" @click.self="emit('cancel')" @keydown.esc="emit('cancel')" @keydown.tab="trap">
		<div class="modal__dialog card" role="dialog" aria-modal="true" :aria-label="title">
			<h2>{{ title }}</h2>
			<p v-if="body">{{ body }}</p>

			<div class="modal__actions">
				<button ref="cancelButton" class="btn btn--ghost" type="button" @click="emit('cancel')">
					Cancel
				</button>
				<button
					ref="confirmButton"
					class="btn btn--danger"
					type="button"
					data-action="confirm"
					@click="emit('confirm')"
				>
					{{ confirmLabel }}
				</button>
			</div>
		</div>
	</div>
</template>
