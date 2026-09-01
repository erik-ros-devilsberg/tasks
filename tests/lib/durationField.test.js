import { describe, it, expect } from 'vitest';

import { formatDuration, parseDuration } from '@/lib/durationField';

describe('parseDuration', () => {
	it('reads a whole number of minutes, because that is what the field means', () => {
		expect(parseDuration('45')).toBe(45);
	});

	it('accepts a number as readily as a string, so a caller need not stringify first', () => {
		expect(parseDuration(90)).toBe(90);
	});

	it('reads a blank field as no duration rather than as zero minutes', () => {
		expect(parseDuration('')).toBeNull();
		expect(parseDuration('   ')).toBeNull();
	});

	it('reads a missing value as no duration', () => {
		expect(parseDuration(null)).toBeNull();
		expect(parseDuration(undefined)).toBeNull();
	});

	it('rounds a decimal to the nearest minute instead of refusing the save', () => {
		// The field is minutes. Half a minute is not a value the server takes, and
		// blocking the whole save over it would be the "computer says no" this app
		// exists to avoid.
		expect(parseDuration('45.6')).toBe(46);
		expect(parseDuration('45.2')).toBe(45);
	});

	it('takes the number out of text rather than discarding the whole entry', () => {
		expect(parseDuration('45 minutes')).toBe(45);
	});

	it('reads junk as no duration, so a typo saves the rest of the form', () => {
		expect(parseDuration('abc')).toBeNull();
		expect(parseDuration('Infinity')).toBeNull();
	});

	it('reads zero as no duration — a task that takes no time has no estimate', () => {
		expect(parseDuration('0')).toBeNull();
	});

	it('reads a negative as no duration, because no task takes less than none', () => {
		expect(parseDuration('-5')).toBeNull();
	});
});

describe('formatDuration', () => {
	it('shows the stored minutes as the field value', () => {
		expect(formatDuration(45)).toBe('45');
	});

	it('leaves the field blank when there is no duration, rather than showing 0', () => {
		// A 0 in the box reads as "this takes no time", which is a claim the record
		// never made.
		expect(formatDuration(null)).toBe('');
		expect(formatDuration(undefined)).toBe('');
	});

	it('leaves the field blank for a stored value it cannot show', () => {
		expect(formatDuration('nonsense')).toBe('');
	});
});

describe('the round trip', () => {
	it('returns what it was given, so opening and saving a form changes nothing', () => {
		expect(parseDuration(formatDuration(30))).toBe(30);
		expect(parseDuration(formatDuration(null))).toBeNull();
	});
});
