import { describe, expect, it } from 'vitest';
import { dwellThresholdMs } from './metrics';

describe('dwellThresholdMs', () => {
	it('clamps to the [1200, 4000] ms range', () => {
		expect(dwellThresholdMs('one two')).toBe(1200); // tiny → floor
		expect(dwellThresholdMs(Array(200).fill('word').join(' '))).toBe(4000); // huge → ceiling
	});

	it('scales with length inside the range', () => {
		const short = dwellThresholdMs(Array(30).fill('w').join(' '));
		const long = dwellThresholdMs(Array(50).fill('w').join(' '));
		expect(long).toBeGreaterThan(short);
	});
});
