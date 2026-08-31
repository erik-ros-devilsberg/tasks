<script setup>
import { onMounted, onUnmounted, ref } from 'vue';

defineProps({
	completedShown: { type: Boolean, default: false },
});

const emit = defineEmits(['refresh', 'toggle-completed', 'sign-out', 'close']);

const panel = ref(null);

let previouslyFocused = null;

onMounted(() => {
	previouslyFocused = document.activeElement;
	// The first item, so a keyboard user lands inside the menu they just opened
	// rather than at the top of the document.
	panel.value?.querySelector('button')?.focus();
});

onUnmounted(() => {
	// Back to the hamburger, which is where they were.
	previouslyFocused?.focus?.();
});
</script>

<template>
	<!--
		Every item closes the menu on its way out: this is a menu, not a panel to
		work from, and leaving it open over the list hides the thing the action
		just changed.
	-->
	<div class="menu" @click.self="emit('close')" @keydown.esc="emit('close')">
		<div ref="panel" class="menu__panel card" role="menu" aria-label="Menu">
			<button
				class="menu__item"
				type="button"
				role="menuitem"
				data-action="refresh"
				@click="emit('refresh')"
			>
				Refresh
			</button>

			<button
				class="menu__item"
				type="button"
				role="menuitem"
				data-action="toggle-completed"
				@click="emit('toggle-completed')"
			>
				{{ completedShown ? 'Hide completed' : 'Show completed' }}
			</button>

			<button
				class="menu__item"
				type="button"
				role="menuitem"
				data-action="sign-out"
				@click="emit('sign-out')"
			>
				Sign out
			</button>
		</div>
	</div>
</template>
