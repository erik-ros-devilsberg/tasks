import { onScopeDispose, ref } from 'vue';

/**
 * Reactive connection state.
 *
 * `navigator.onLine` is optimistic — it reports "online" for a connection that
 * cannot reach anything. It is still the right trigger for draining the outbox:
 * a failed flush costs nothing and retries next time.
 */
export function useOnline() {
	const online = ref(navigator.onLine);

	const update = () => {
		online.value = navigator.onLine;
	};

	window.addEventListener('online', update);
	window.addEventListener('offline', update);

	onScopeDispose(() => {
		window.removeEventListener('online', update);
		window.removeEventListener('offline', update);
	});

	return online;
}
