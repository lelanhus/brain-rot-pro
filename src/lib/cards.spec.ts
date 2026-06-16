import { describe, expect, it } from 'vitest';
import { formatName, relativeTime } from './cards';

describe('formatName', () => {
	const known = [
		'surprise_fact',
		'myth_buster',
		'hidden_connection',
		'mini_biography',
		'origin_story',
		'timeline_shock',
		'cause_effect',
		'object_story'
	];

	it('returns a non-empty label for every known format', () => {
		for (const format of known) {
			expect(formatName(format)).toBeTruthy();
		}
	});

	it('falls back to "Fact" for an unknown format', () => {
		expect(formatName('not_a_real_format')).toBe('Fact');
	});
});

describe('relativeTime', () => {
	const now = Date.parse('2026-06-16T12:00:00Z');
	const ago = (ms: number) => relativeTime(now - ms, now);

	it('shows "just now" for very recent timestamps', () => {
		expect(ago(0)).toBe('just now');
		expect(ago(10_000)).toBe('just now');
	});

	it('scales through minutes, hours, days, and weeks', () => {
		expect(ago(5 * 60_000)).toBe('5m');
		expect(ago(3 * 3_600_000)).toBe('3h');
		expect(ago(2 * 86_400_000)).toBe('2d');
		expect(ago(21 * 86_400_000)).toBe('3w');
	});

	it('never returns a negative interval for a future timestamp', () => {
		expect(relativeTime(now + 60_000, now)).toBe('just now');
	});
});
