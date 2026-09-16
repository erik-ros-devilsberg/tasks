import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';

import { useRetryingSync, RETRY_DELAYS } from '@/composables/useRetryingSync';

/**
 * The composable needs a component to own its lifecycle. This is the smallest
 * one that gives it a scope to be torn down with.
 */
function host(sync) {
	return mount({
		template: '<div />',
		setup() {
			useRetryingSync(sync);

			return {};
		},
	});
}

/**
 * Lets the pending promise chain settle. `run` awaits the sync before it
 * schedules the next attempt, so the timer does not exist until several
 * microtasks after the call that started it.
 */
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await Promise.resolve();
	}
};

async function advance(ms) {
	await settle();
	await vi.advanceTimersByTimeAsync(ms);
	await settle();
}

beforeEach(() => {
	vi.useFakeTimers();
	Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('a sync that gets through', () => {
	it('runs once and then leaves the server alone', async () => {
		const sync = vi.fn(async () => true);

		host(sync);
		await settle();

		expect(sync).toHaveBeenCalledOnce();

		await advance(RETRY_DELAYS.at(-1) * 2);

		expect(sync).toHaveBeenCalledOnce();
	});
});

describe('a sync that does not get through', () => {
	it('tries again without being asked, so the app heals itself', async () => {
		const sync = vi.fn(async () => false);

		host(sync);
		await settle();

		expect(sync).toHaveBeenCalledTimes(1);

		await advance(RETRY_DELAYS[0]);

		expect(sync).toHaveBeenCalledTimes(2);
	});

	it('backs off rather than hammering a server that is already struggling', async () => {
		const sync = vi.fn(async () => false);

		host(sync);
		await settle();

		await advance(RETRY_DELAYS[0]);
		expect(sync).toHaveBeenCalledTimes(2);

		// The first delay again is not enough for the second attempt.
		await advance(RETRY_DELAYS[0]);
		expect(sync).toHaveBeenCalledTimes(2);

		await advance(RETRY_DELAYS[1] - RETRY_DELAYS[0]);
		expect(sync).toHaveBeenCalledTimes(3);
	});

	it('keeps trying at the longest interval rather than giving up', async () => {
		// A server that has been down for an hour is still a server that may come
		// back. Giving up would need the user to do something, which is the whole
		// thing being avoided.
		const sync = vi.fn(async () => false);

		host(sync);
		await settle();

		for (const delay of RETRY_DELAYS) {
			await advance(delay);
		}

		const attempts = sync.mock.calls.length;

		await advance(RETRY_DELAYS.at(-1));

		expect(sync).toHaveBeenCalledTimes(attempts + 1);
	});

	it('starts over from the short delay after one gets through, not from the long one', async () => {
		// A success ends the loop, so the next outage is a fresh one: it must not
		// inherit the patience the last one earned and leave the user waiting five
		// minutes for the first retry.
		let answer = false;
		const sync = vi.fn(async () => answer);

		host(sync);
		await settle();

		await advance(RETRY_DELAYS[0]);
		await advance(RETRY_DELAYS[1]);
		expect(sync).toHaveBeenCalledTimes(3);

		answer = true;
		await advance(RETRY_DELAYS[2]);
		expect(sync).toHaveBeenCalledTimes(4);

		// Nothing is scheduled after a success, and the counter is back to zero, so
		// the next outage starts at the short delay.
		expect(RETRY_DELAYS[0]).toBeLessThan(RETRY_DELAYS.at(-1));

		await advance(RETRY_DELAYS.at(-1) * 2);

		expect(sync).toHaveBeenCalledTimes(4);
	});
});

describe('while the app is out of sight', () => {
	it('does not retry in a hidden tab, which would be work nobody is waiting for', async () => {
		Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
		const sync = vi.fn(async () => false);

		host(sync);
		await settle();
		sync.mockClear();

		await advance(RETRY_DELAYS[0]);

		expect(sync).not.toHaveBeenCalled();
	});

	it('resumes its schedule when the tab is back, without syncing twice for one return', async () => {
		// Coming back to the tab belongs to useRefreshOnReturn, which syncs at
		// once and dedupes the visibilitychange/focus pair. This only restarts the
		// backoff it paused.
		Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
		const sync = vi.fn(async () => false);

		host(sync);
		await settle();
		sync.mockClear();

		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
		await settle();

		expect(sync).not.toHaveBeenCalled();

		await advance(RETRY_DELAYS[0]);

		expect(sync).toHaveBeenCalledOnce();
	});
});

describe('when the view goes away', () => {
	it('stops, so a torn-down component cannot keep syncing forever', async () => {
		const sync = vi.fn(async () => false);

		const wrapper = host(sync);
		await settle();
		wrapper.unmount();
		sync.mockClear();

		await advance(RETRY_DELAYS.at(-1) * 2);

		expect(sync).not.toHaveBeenCalled();
	});
});
