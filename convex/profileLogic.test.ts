import { describe, expect, it } from 'vitest';
import { accumulateWeights, scoreCard, FOCUS_BOOST, SEEN_PENALTY } from './profileLogic';

describe('accumulateWeights', () => {
	it('adds positive weight for likes and negative for not-interested', () => {
		const events = [
			{ type: 'save', cardId: 'a' },
			{ type: 'not_interested', cardId: 'b' }
		];
		const tags = { a: ['rome', 'history'], b: ['sports'] };
		const w = accumulateWeights(events, tags);
		expect(w.rome).toBe(3);
		expect(w.history).toBe(3);
		expect(w.sports).toBe(-4);
	});

	it('ignores events without a card or with no delta', () => {
		const w = accumulateWeights([{ type: 'session_start' }, { type: 'save', cardId: null }], {});
		expect(Object.keys(w)).toHaveLength(0);
	});
});

describe('scoreCard', () => {
	it('ranks higher-affinity cards above lower ones', () => {
		const weights = { rome: 5, sports: -3 };
		const liked = scoreCard(['rome'], weights, { seen: false, shuffleKey: 0.5 });
		const disliked = scoreCard(['sports'], weights, { seen: false, shuffleKey: 0.5 });
		expect(liked).toBeGreaterThan(disliked);
	});

	it('penalizes seen cards', () => {
		const weights = { rome: 5 };
		const fresh = scoreCard(['rome'], weights, { seen: false, shuffleKey: 0.5 });
		const seen = scoreCard(['rome'], weights, { seen: true, shuffleKey: 0.5 });
		expect(fresh - seen).toBeCloseTo(SEEN_PENALTY);
	});

	it('floats a focused concept above even a seen, otherwise-disliked card', () => {
		const weights = { rome: 5, sport: -3 };
		// A focused card with weak/negative affinity still outranks a high-affinity
		// non-match, so "explore this" reliably surfaces the concept.
		const focusedSeen = scoreCard(['sport'], weights, {
			seen: true,
			shuffleKey: 0,
			focusConcept: 'sport'
		});
		const unfocusedLiked = scoreCard(['rome'], weights, {
			seen: false,
			shuffleKey: 1,
			focusConcept: 'sport'
		});
		expect(focusedSeen).toBeGreaterThan(unfocusedLiked);
		expect(focusedSeen - unfocusedLiked).toBeLessThan(FOCUS_BOOST); // it's a boost, not a wipe
	});

	it('ignores a focus concept a card does not carry', () => {
		const weights = { rome: 5 };
		const withFocus = scoreCard(['rome'], weights, {
			seen: false,
			shuffleKey: 0.5,
			focusConcept: 'sport'
		});
		const without = scoreCard(['rome'], weights, { seen: false, shuffleKey: 0.5 });
		expect(withFocus).toBe(without);
	});
});
