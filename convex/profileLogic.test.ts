import { describe, expect, it } from 'vitest';
import {
	accumulateWeights,
	scoreCard,
	FOCUS_BOOST,
	buildTasteVector,
	TASTE_HALFLIFE_MS,
	scoreByTaste,
	INTEREST_BOOST
} from './profileLogic';

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
		const liked = scoreCard(['rome'], weights, { shuffleKey: 0.5 });
		const disliked = scoreCard(['sports'], weights, { shuffleKey: 0.5 });
		expect(liked).toBeGreaterThan(disliked);
	});

	it('floats a focused concept above an otherwise-disliked card', () => {
		const weights = { rome: 5, sport: -3 };
		// A focused card with weak/negative affinity still outranks a high-affinity
		// non-match, so "explore this" reliably surfaces the concept.
		const focusedWeak = scoreCard(['sport'], weights, {
			shuffleKey: 0,
			focusConcept: 'sport'
		});
		const unfocusedLiked = scoreCard(['rome'], weights, {
			shuffleKey: 1,
			focusConcept: 'sport'
		});
		expect(focusedWeak).toBeGreaterThan(unfocusedLiked);
		expect(focusedWeak - unfocusedLiked).toBeLessThan(FOCUS_BOOST); // it's a boost, not a wipe
	});

	it('ignores a focus concept a card does not carry', () => {
		const weights = { rome: 5 };
		const withFocus = scoreCard(['rome'], weights, {
			shuffleKey: 0.5,
			focusConcept: 'sport'
		});
		const without = scoreCard(['rome'], weights, { shuffleKey: 0.5 });
		expect(withFocus).toBe(without);
	});
});

describe('buildTasteVector', () => {
	const NOW = 1_000_000_000_000;
	it('returns undefined when no positive event has an embedding', () => {
		const events = [{ type: 'card_skip', cardId: 'a', ts: NOW }];
		expect(buildTasteVector(events, { a: [1, 0] }, NOW)).toBeUndefined();
		// positive event but no embedding for the card:
		expect(buildTasteVector([{ type: 'save', cardId: 'b', ts: NOW }], {}, NOW)).toBeUndefined();
	});

	it('averages positively-engaged embeddings weighted by EVENT_DELTA', () => {
		// save (delta 3) of [1,0] and complete (delta 1) of [0,1], same time → (3·[1,0]+1·[0,1])/4
		const events = [
			{ type: 'save', cardId: 'a', ts: NOW },
			{ type: 'card_complete', cardId: 'b', ts: NOW }
		];
		const v = buildTasteVector(events, { a: [1, 0], b: [0, 1] }, NOW)!;
		expect(v[0]).toBeCloseTo(0.75);
		expect(v[1]).toBeCloseTo(0.25);
	});

	it('ignores skip / not_interested when shaping taste', () => {
		const events = [
			{ type: 'save', cardId: 'a', ts: NOW },
			{ type: 'not_interested', cardId: 'b', ts: NOW },
			{ type: 'card_skip', cardId: 'c', ts: NOW }
		];
		const v = buildTasteVector(events, { a: [1, 0], b: [0, 1], c: [0, 1] }, NOW)!;
		expect(v[0]).toBeCloseTo(1); // only 'a' contributed
		expect(v[1]).toBeCloseTo(0);
	});

	it('weights recent engagement more (recency half-life)', () => {
		const old = NOW - TASTE_HALFLIFE_MS; // one half-life ago → weight halved
		const events = [
			{ type: 'save', cardId: 'a', ts: NOW }, // [1,0] weight 3·1
			{ type: 'save', cardId: 'b', ts: old } //  [0,1] weight 3·0.5
		];
		const v = buildTasteVector(events, { a: [1, 0], b: [0, 1] }, NOW)!;
		expect(v[0]).toBeCloseTo(2 / 3);
		expect(v[1]).toBeCloseTo(1 / 3);
	});

	it('skips embeddings whose length mismatches the accumulator (no throw)', () => {
		const events = [
			{ type: 'save', cardId: 'a', ts: NOW },
			{ type: 'save', cardId: 'b', ts: NOW }
		];
		const v = buildTasteVector(events, { a: [1, 0], b: [1, 0, 0] }, NOW)!;
		expect(v.length).toBe(2); // only 'a' contributed; mismatched 'b' skipped
		expect(v[0]).toBeCloseTo(1);
	});
});

describe('scoreByTaste', () => {
	const taste = [1, 0];
	it('ranks an on-taste card above an off-taste card', () => {
		const near = scoreByTaste(
			{ conceptTags: [], embedding: [1, 0] },
			{ tasteVector: taste, weights: {}, shuffleKey: 0 }
		);
		const far = scoreByTaste(
			{ conceptTags: [], embedding: [0, 1] },
			{ tasteVector: taste, weights: {}, shuffleKey: 0 }
		);
		expect(near).toBeGreaterThan(far);
	});

	it('falls back to scoreCard when there is no taste vector', () => {
		const liked = scoreByTaste(
			{ conceptTags: ['x'], embedding: [1, 0] },
			{ tasteVector: undefined, weights: { x: 5 }, shuffleKey: 0 }
		);
		const neutral = scoreByTaste(
			{ conceptTags: ['y'], embedding: [1, 0] },
			{ tasteVector: undefined, weights: { x: 5 }, shuffleKey: 0 }
		);
		expect(liked).toBeGreaterThan(neutral); // concept-affinity, not embedding
	});

	it('falls back to scoreCard when the card has no embedding', () => {
		const score = scoreByTaste(
			{ conceptTags: ['x'] },
			{ tasteVector: taste, weights: { x: 5 }, shuffleKey: 0 }
		);
		// equals the concept-affinity score (5) — no embedding term applied
		expect(score).toBeCloseTo(5);
	});

	it('falls back to scoreCard on embedding/taste dimension mismatch (no throw)', () => {
		const score = scoreByTaste(
			{ conceptTags: ['x'], embedding: [1, 0, 0] },
			{ tasteVector: [1, 0], weights: { x: 5 }, shuffleKey: 0 }
		);
		expect(score).toBeCloseTo(5); // concept-affinity fallback, no cosine throw
	});
});

describe('scoreByTaste interest boost', () => {
	const base = { conceptTags: ['x'], embedding: undefined, slug: 'cleopatra' };
	const ctx = { tasteVector: undefined, weights: {}, shuffleKey: 0, focusConcept: null };
	it('adds INTEREST_BOOST iff the card slug is followed', () => {
		const followed = new Set(['cleopatra']);
		const withBoost = scoreByTaste(base, { ...ctx, interestSlugs: followed });
		const without = scoreByTaste(base, { ...ctx, interestSlugs: new Set() });
		expect(withBoost - without).toBeCloseTo(INTEREST_BOOST);
	});
});
