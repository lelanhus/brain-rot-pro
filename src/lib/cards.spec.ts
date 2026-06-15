import { describe, expect, it } from 'vitest';
import { formatName } from './cards';

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
