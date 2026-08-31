import { describe, it, expect } from 'vitest';

import { formatDue } from '@/lib/formatDue';

const task = (due_at) => ({ id: '1', title: 'Task', notes: null, due_at, completed_at: null });

const now = new Date(2026, 7, 30, 12, 0);

describe('whatever time is registered is the time that is shown', () => {
	it('shows the registered hour and minute exactly, with no zone conversion', () => {
		expect(formatDue(task('2026-09-05T14:30:00.000000Z'), now)).toContain('14:30');
	});

	it('ignores an offset on the string rather than applying it', () => {
		// Applying +05:00 would print 09:30 in UTC, or something else again in
		// the browser's zone. The registered wall clock is 14:30 and stays 14:30.
		expect(formatDue(task('2026-09-05T14:30:00+05:00'), now)).toContain('14:30');
	});

	it('shows midnight as midnight rather than rolling into the previous day', () => {
		const shown = formatDue(task('2026-09-05T00:00:00.000000Z'), now);

		expect(shown).toContain('00:00');
		expect(shown).toContain('5 Sep');
	});
});

describe('granularity', () => {
	it('shows a date-only due date with no time attached', () => {
		const shown = formatDue(task('2026-09-05'), now);

		expect(shown).toBe('5 Sept');
	});

	it('shows a date-only due date on its own day, not the one before it', () => {
		// The classic failure: 'YYYY-MM-DD' parsed as UTC midnight renders as the
		// 4th anywhere west of Greenwich.
		expect(formatDue(task('2026-09-05'), now)).toContain('5 Sep');
	});

	it('adds the time when one was registered', () => {
		expect(formatDue(task('2026-09-05T14:30:00.000000Z'), now)).toBe('5 Sept, 14:30');
	});
});

describe('the year', () => {
	it('is left off within the current year, where it says nothing', () => {
		expect(formatDue(task('2026-09-05'), now)).not.toContain('2026');
	});

	it('is shown for another year, where leaving it off would mislead', () => {
		expect(formatDue(task('2027-09-05'), now)).toContain('2027');
	});
});

describe('no due date', () => {
	it('renders nothing at all', () => {
		expect(formatDue(task(null), now)).toBe('');
	});
});
