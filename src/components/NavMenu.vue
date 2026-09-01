<script setup>
import { onMounted, onUnmounted, ref } from 'vue';

defineProps({
	completedShown: { type: Boolean, default: false },
	pendingCount: { type: Number, default: 0 },
	syncing: { type: Boolean, default: false },
});

const emit = defineEmits(['sync', 'toggle-completed', 'sign-out', 'close']);

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
			<!--
				"Sync now" rather than "Refresh": there may be work to push as well
				as pull, and the count says how much. Disabled mid-sync so a second
				press cannot start a drain on top of the first.
			-->
			<button
				class="menu__item"
				type="button"
				role="menuitem"
				data-action="sync"
				:disabled="syncing"
				@click="emit('sync')"
			>
				{{ syncing ? 'Syncing…' : 'Sync now' }}
				<span v-if="pendingCount > 0" class="badge badge--pending">{{ pendingCount }}</span>
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
