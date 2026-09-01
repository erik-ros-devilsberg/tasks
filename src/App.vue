<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { useSessionStore } from '@/stores/session';
import { useTasksStore } from '@/stores/tasks';
import { useOnline } from '@/composables/useOnline';
import NavMenu from '@/components/NavMenu.vue';

const version = __APP_VERSION__;

const router = useRouter();
const session = useSessionStore();
const tasks = useTasksStore();
const online = useOnline();

const menuOpen = ref(false);
const updateReady = ref(false);

const showUpdate = () => {
	updateReady.value = true;
};

onMounted(() => {
	window.addEventListener('app-update-ready', showUpdate);
});

onUnmounted(() => {
	window.removeEventListener('app-update-ready', showUpdate);
});

/**
 * A sync found the session gone. Handled here rather than in each view: any
 * view can be on screen when it happens, and the token is already cleared by
 * then. These tasks belong to the account that just ended, and this device may
 * be handed to someone else.
 */
watch(
	() => tasks.unauthorized,
	async (ended) => {
		if (ended) {
			await tasks.forget();
			await router.replace('/login');
		}
	},
);

async function sync() {
	menuOpen.value = false;
	await tasks.syncNow();
}

function toggleCompleted() {
	menuOpen.value = false;
	tasks.completedShown = !tasks.completedShown;
}

async function signOut() {
	menuOpen.value = false;
	await session.logout();
	// The cached tasks and anything still queued belong to the account that just
	// left. This device is shared.
	await tasks.forget();
	await router.replace('/login');
}
</script>

<template>
	<a class="skip-link" href="#main">Skip to content</a>

	<nav class="nav">
		<div class="container nav__inner">
			<router-link class="nav__brand wordmark" to="/">Tasks</router-link>

			<div class="nav__links">
				<button
					v-if="session.isAuthenticated"
					class="btn btn--ghost btn--icon"
					type="button"
					data-action="menu"
					aria-label="Menu"
					:aria-expanded="menuOpen ? 'true' : 'false'"
					@click="menuOpen = !menuOpen"
				>
					<!-- Three bars drawn, not typed: no glyph for this reads reliably. -->
					<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
						<path d="M4 7h16M4 12h16M4 17h16" />
					</svg>
				</button>
			</div>
		</div>
	</nav>

	<!--
		Being offline is the app working, not a fault, so it is stated rather than
		warned about. The count is what the user actually needs: how much of their
		work has not left the device yet.
	-->
	<p v-if="session.isAuthenticated && !online" class="conn conn--offline" data-state="offline">
		Offline. Your changes are saved here and will sync when you are back.
	</p>

	<p v-else-if="session.isAuthenticated && tasks.pendingCount > 0" class="conn" data-state="pending">
		{{ tasks.pendingCount }} {{ tasks.pendingCount === 1 ? 'change' : 'changes' }} waiting to sync.
	</p>

	<NavMenu
		v-if="menuOpen"
		:completed-shown="tasks.completedShown"
		:pending-count="tasks.pendingCount"
		:syncing="tasks.syncing"
		@sync="sync"
		@toggle-completed="toggleCompleted"
		@sign-out="signOut"
		@close="menuOpen = false"
	/>

	<!--
		A new version is ready, but reloading now would take the page out from
		under whatever the user is typing. Let them choose the moment.
	-->
	<div v-if="updateReady" class="container mt-2">
		<p class="notice">
			A new version is ready.
			<button class="btn btn--sm" type="button" data-action="reload" @click="location.reload()">
				Reload
			</button>
		</p>
	</div>

	<main id="main" class="app-main" tabindex="-1">
		<router-view />
	</main>

	<footer class="footer">
		<div class="container footer__inner">
			<span class="text-muted">{{ version }}</span>
		</div>
	</footer>
</template>
