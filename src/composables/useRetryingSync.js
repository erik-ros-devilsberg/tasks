import { onMounted, onUnmounted } from 'vue';

/**
 * How long to wait before trying again, in milliseconds.
 *
 * Short at first, because the common case is a server restarting or a tunnel a
 * train is about to leave, and the user is still looking at the screen. Then
 * longer, because a server that has been down for a minute is not likely to be
 * back in the next second, and a phone retrying every few seconds is a phone
 * spending its battery on nothing. The last value repeats for as long as it
 * takes.
 */
export const RETRY_DELAYS = [5_000, 15_000, 60_000, 300_000];

/**
 * Keeps syncing until it lands.
 *
 * A sync that does not get through is a state the app deals with by itself: the
 * work is already on the device, the outbox is durable and ordered, and the only
 * thing missing is a server that will answer. Nothing here is shown to anyone —
 * telling the user their phone is in a tunnel gives them a problem without a
 * solution.
 *
 * `sync` is expected to resolve to whether it got through, and never to throw.
 *
 * This is not the poll that `useRefreshOnReturn` deliberately avoids. That one
 * would be a timer asking whether anything changed, which for a user working
 * alone is load spent to learn that nothing did. This one runs only while a sync
 * is known to be failing, and stops the moment one succeeds.
 */
export function useRetryingSync(sync) {
	let timer = null;
	let attempt = 0;
	let stopped = false;
	// Whether the last attempt failed. Distinct from `attempt`, which counts only
	// the retries actually scheduled — a schedule paused by a hidden tab never
	// increments it, and resuming has to know there is something to resume.
	let failing = false;

	function cancel() {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	}

	function schedule() {
		cancel();

		// A hidden tab is nobody waiting. `visibilitychange` starts it again.
		if (stopped || document.visibilityState === 'hidden') {
			return;
		}

		const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];

		timer = setTimeout(run, delay);
		// Counted after the delay is read, so the first retry is the first delay
		// rather than the second.
		attempt += 1;
	}

	async function run() {
		if (stopped) {
			return;
		}

		const landed = await sync();

		if (stopped) {
			return;
		}

		failing = !landed;

		if (landed) {
			// The next outage gets the short delays again rather than inheriting
			// the patience earned by the last one.
			attempt = 0;
			cancel();

			return;
		}

		schedule();
	}

	/*
	 * Resumes the schedule, rather than syncing straight away: coming back to the
	 * tab is `useRefreshOnReturn`'s event, and it already dedupes the
	 * visibilitychange/focus pair that a single return fires. Starting a sync here
	 * too would send two for every tab switch.
	 */
	function onVisible() {
		if (document.visibilityState === 'visible' && timer === null && failing) {
			schedule();
		}
	}

	onMounted(() => {
		document.addEventListener('visibilitychange', onVisible);
		run();
	});

	onUnmounted(() => {
		stopped = true;
		cancel();
		document.removeEventListener('visibilitychange', onVisible);
	});
}
