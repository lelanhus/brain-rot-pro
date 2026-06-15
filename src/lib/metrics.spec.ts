import { describe, expect, it } from 'vitest';
import { computeCcr, dwellThresholdMs, isContinuation } from './metrics';

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

describe('isContinuation', () => {
	it('treats positive interactions as continuations', () => {
		for (const t of ['card_complete', 'save', 'card_expand', 'source_open', 'related_tap']) {
			expect(isContinuation(t)).toBe(true);
		}
	});
	it('does not treat skips/impressions as continuations', () => {
		expect(isContinuation('card_skip')).toBe(false);
		expect(isContinuation('card_impression')).toBe(false);
		expect(isContinuation('not_interested')).toBe(false);
	});
});

describe('computeCcr', () => {
	it('is 0 with no impressions', () => {
		expect(computeCcr([])).toBe(0);
		expect(computeCcr([{ type: 'save' }])).toBe(0);
	});

	it('is continuations / impressions', () => {
		const events = [
			{ type: 'card_impression' },
			{ type: 'card_complete' },
			{ type: 'card_impression' },
			{ type: 'card_skip' },
			{ type: 'card_impression' },
			{ type: 'save' }
		];
		// 3 impressions, 2 continuations (complete, save)
		expect(computeCcr(events)).toBeCloseTo(2 / 3);
	});
});
