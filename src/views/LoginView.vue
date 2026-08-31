<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { useSessionStore } from '@/stores/session';

const router = useRouter();
const session = useSessionStore();

const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
	busy.value = true;
	error.value = '';

	try {
		await session.login(email.value, password.value);
		await router.replace('/');
	} catch (failure) {
		// Never clear the form on failure — retyping a password because the
		// server said no is the definition of "computer says no".
		error.value = failure.message;
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<section class="app-view container">
		<h1>Sign in</h1>

		<p v-if="session.expired" class="notice">
			Your session ended. Sign in again to pick up where you left off.
		</p>

		<form class="form" @submit.prevent="submit">
			<div class="field">
				<label for="email">Email</label>
				<input id="email" v-model="email" type="email" autocomplete="username" required />
			</div>

			<div class="field">
				<label for="password">Password</label>
				<input
					id="password"
					v-model="password"
					type="password"
					autocomplete="current-password"
					required
				/>
			</div>

			<p v-if="error" class="error">{{ error }}</p>

			<div class="form__actions">
				<!-- Disabled while in flight: the login endpoint allows 6/minute. -->
				<button class="btn btn--primary" type="submit" :disabled="busy">
					{{ busy ? 'Signing in' : 'Sign in' }}
				</button>
			</div>
		</form>

		<p class="mt-2">
			<!-- Password reset is an account-level action and stays on the server. -->
			<a href="/forgot-password">Forgotten your password?</a>
		</p>
	</section>
</template>
