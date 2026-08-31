<script setup>
import { useRouter } from 'vue-router';

import { useSessionStore } from '@/stores/session';
import { useTasksStore } from '@/stores/tasks';

const version = __APP_VERSION__;

const router = useRouter();
const session = useSessionStore();
const tasks = useTasksStore();

async function signOut() {
	await session.logout();
	// The loaded tasks belong to the account that just left this device.
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
				<span class="nav__version text-muted">{{ version }}</span>

				<button
					v-if="session.isAuthenticated"
					class="btn btn--ghost btn--sm"
					type="button"
					data-action="sign-out"
					@click="signOut"
				>
					Sign out
				</button>
			</div>
		</div>
	</nav>

	<main id="main" class="app-main" tabindex="-1">
		<router-view />
	</main>
</template>
