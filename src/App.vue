<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { useSessionStore } from '@/stores/session';
import { useTasksStore } from '@/stores/tasks';
import NavMenu from '@/components/NavMenu.vue';

const version = __APP_VERSION__;

const router = useRouter();
const session = useSessionStore();
const tasks = useTasksStore();

const menuOpen = ref(false);

/**
 * The store rethrows a 401. The token is already gone by then, and these tasks
 * belong to the account that just ended — on a shared device, leaving them on
 * screen is the bug.
 */
async function endSession() {
	tasks.forget();
	await router.replace('/login');
}

async function refresh() {
	menuOpen.value = false;

	try {
		await tasks.load();
	} catch {
		await endSession();
	}
}

function toggleCompleted() {
	menuOpen.value = false;
	tasks.completedShown = !tasks.completedShown;
}

async function signOut() {
	menuOpen.value = false;
	await session.logout();
	tasks.forget();
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

	<NavMenu
		v-if="menuOpen"
		:completed-shown="tasks.completedShown"
		@refresh="refresh"
		@toggle-completed="toggleCompleted"
		@sign-out="signOut"
		@close="menuOpen = false"
	/>

	<main id="main" class="app-main" tabindex="-1">
		<router-view />
	</main>

	<footer class="footer">
		<div class="container footer__inner">
			<span class="text-muted">{{ version }}</span>
		</div>
	</footer>
</template>
