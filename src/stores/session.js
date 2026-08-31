import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import { ApiError, createApi } from '@/lib/api';

export const TOKEN_KEY = 'coevta-tasks.token';

/**
 * The one place that knows whether we are signed in.
 *
 * The token lives in localStorage rather than in Pinia alone: Pinia dies on
 * reload, and the router guard has to answer synchronously before anything
 * async has run. Its own key prefix keeps it clear of the sibling apps.
 */
export const useSessionStore = defineStore('session', () => {
	const token = ref(localStorage.getItem(TOKEN_KEY));
	const expired = ref(false);

	const isAuthenticated = computed(() => token.value !== null);

	function setToken(value) {
		token.value = value;

		if (value) {
			localStorage.setItem(TOKEN_KEY, value);
		} else {
			localStorage.removeItem(TOKEN_KEY);
		}
	}

	// Every authenticated request in the app goes through this instance, so a
	// 401 is handled once here rather than at each call site.
	const api = createApi({
		getToken: () => token.value,
		onUnauthorized: () => {
			expired.value = true;
			setToken(null);
		},
	});

	async function login(email, password) {
		expired.value = false;

		try {
			const data = await api.post('/login', { email, password });
			setToken(data.token);

			return data;
		} catch (error) {
			// The server throttles login to 6/minute and answers with an empty
			// body, so the default "Request failed (429)" would tell the user
			// nothing actionable.
			if (error instanceof ApiError && error.status === 429) {
				throw new ApiError(429, 'Too many sign-in attempts. Wait a minute and try again.');
			}

			throw error;
		}
	}

	async function logout() {
		try {
			await api.post('/logout');
		} catch {
			// Signing out is a local act. If the token cannot be revoked now it
			// expires on its own; refusing to sign the user out would be worse.
		}

		setToken(null);
	}

	return { token, expired, isAuthenticated, api, login, logout, setToken };
});
