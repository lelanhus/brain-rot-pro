/**
 * Pure personalization scoring (ADR-007). Behavioral signals → concept weights,
 * and concept weights + novelty → a card score. Separated from Convex so it's
 * unit-testable without a deployment. Seen exclusion is handled upstream via
 * the seenCards table (never-repeat guarantee); scoreCard no longer needs it.
 */

import { cosineSimilarity } from './embedLogic';

/** How much each event type shifts the weight of a card's concepts. */
export const EVENT_DELTA: Record<string, number> = {
	save: 3,
	card_expand: 2,
	related_tap: 2,
	source_open: 1.5,
	card_complete: 1,
	card_skip: -0.5,
	not_interested: -4
};

/** Wildcard/novelty weight on the stored random key (keeps discovery alive). */
export const WILDCARD_WEIGHT = 0.4;
/**
 * Boost for a user-chosen focus concept ("explore this"). Large enough to float
 * every matching card above the personalized ranking, but additive — so we
 * reorder rather than filter, and the feed never empties when a concept runs dry.
 */
export const FOCUS_BOOST = 100;
/** How hard taste-similarity (cosine ≈0–1) drives ranking vs the novelty term.
 * High enough that relevance dominates while WILDCARD_WEIGHT still reshuffles
 * near-ties (the discovery slice). */
export const RELEVANCE_WEIGHT = 10;

/** Additive rank bump for cards whose source topic the user explicitly follows. */
export const INTEREST_BOOST = 5;

/** Half-life for recency weighting of taste signals (14 days). */
export const TASTE_HALFLIFE_MS = 14 * 24 * 60 * 60 * 1000;

/** Graded engagement weight: card_complete scales by dwell vs the user's own
 * baseline (clamped); explicit/negative events keep their flat EVENT_DELTA. */
export function engagementWeight(
	type: string,
	visibleMs: number | undefined,
	userAvgDwell: number
): number {
	const base = EVENT_DELTA[type];
	if (base === undefined) return 0;
	if (type !== 'card_complete' || visibleMs === undefined || userAvgDwell <= 0) return base;
	const ratio = Math.min(2.5, Math.max(0.5, visibleMs / userAvgDwell));
	return base * ratio;
}

/** Mean dwell (visibleMs) over a user's card_complete events; 0 when none. */
export function meanCompleteDwell(
	events: ReadonlyArray<{ type: string; visibleMs?: number }>
): number {
	let sum = 0;
	let n = 0;
	for (const e of events) {
		if (e.type === 'card_complete' && e.visibleMs !== undefined) {
			sum += e.visibleMs;
			n += 1;
		}
	}
	return n === 0 ? 0 : sum / n;
}

export type WeightedEvent = { type: string; cardId?: string | null; visibleMs?: number };

/** Accumulate concept weights from events, given each card's concept tags. */
export function accumulateWeights(
	events: ReadonlyArray<WeightedEvent>,
	tagsByCard: Record<string, string[]>,
	userAvgDwell = 0
): Record<string, number> {
	const weights: Record<string, number> = {};
	for (const e of events) {
		if (!e.cardId) continue;
		const delta = engagementWeight(e.type, e.visibleMs, userAvgDwell);
		if (delta === 0) continue;
		for (const tag of tagsByCard[e.cardId] ?? []) {
			weights[tag] = (weights[tag] ?? 0) + delta;
		}
	}
	return weights;
}

/** Score a card for the personalized feed. Higher = show sooner. */
export function scoreCard(
	tags: string[],
	weights: Record<string, number>,
	opts: { shuffleKey: number; focusConcept?: string | null }
): number {
	let score = 0;
	for (const tag of tags) score += weights[tag] ?? 0;
	score += WILDCARD_WEIGHT * opts.shuffleKey;
	if (opts.focusConcept && tags.includes(opts.focusConcept)) score += FOCUS_BOOST;
	return score;
}

/**
 * Per-user taste vector: a recency-favored, EVENT_DELTA-weighted average of the
 * embeddings of POSITIVELY-engaged cards. Negatives (skip/not_interested) are
 * ignored — they only exclude cards elsewhere. Returns undefined when no
 * positive event has an embedding (cold-start). Pure → unit-testable.
 */
export function buildTasteVector(
	events: ReadonlyArray<{ type: string; cardId?: string | null; ts: number; visibleMs?: number }>,
	embeddingByCard: Record<string, number[] | undefined>,
	now: number,
	userAvgDwell = 0
): number[] | undefined {
	let acc: number[] | null = null;
	let totalWeight = 0;
	for (const e of events) {
		if (e.cardId === undefined || e.cardId === null) continue;
		const delta = engagementWeight(e.type, e.visibleMs, userAvgDwell);
		if (delta <= 0) continue; // positives only
		const emb = embeddingByCard[e.cardId];
		if (emb === undefined) continue;
		const recency = Math.pow(0.5, Math.max(0, now - e.ts) / TASTE_HALFLIFE_MS);
		const w = delta * recency;
		if (w <= 0) continue;
		if (acc === null) acc = new Array<number>(emb.length).fill(0);
		if (emb.length !== acc.length) continue; // dimension guard
		for (let i = 0; i < acc.length; i++) acc[i] += w * emb[i];
		totalWeight += w;
	}
	if (acc === null || totalWeight === 0) return undefined;
	return acc.map((x) => x / totalWeight);
}

/**
 * Taste-aware score: when a taste vector and the card's embedding are both
 * present, rank by cosine similarity + novelty + focus. Otherwise fall back to
 * concept-affinity (scoreCard) — cold-start and un-embedded cards rank sanely.
 * An optional interest boost is added at the end when the card's slug is in
 * the device's followed topics set.
 */
export function scoreByTaste(
	card: { conceptTags: string[]; embedding?: number[]; slug?: string },
	ctx: {
		tasteVector?: number[];
		weights: Record<string, number>;
		shuffleKey: number;
		focusConcept?: string | null;
		interestSlugs?: ReadonlySet<string>;
	}
): number {
	const emb = card.embedding;
	let score: number;
	if (ctx.tasteVector !== undefined && emb !== undefined && emb.length === ctx.tasteVector.length) {
		score = RELEVANCE_WEIGHT * cosineSimilarity(ctx.tasteVector, emb);
		score += WILDCARD_WEIGHT * ctx.shuffleKey;
		if (ctx.focusConcept && card.conceptTags.includes(ctx.focusConcept)) score += FOCUS_BOOST;
	} else {
		score = scoreCard(card.conceptTags, ctx.weights, {
			shuffleKey: ctx.shuffleKey,
			focusConcept: ctx.focusConcept
		});
	}
	if (ctx.interestSlugs !== undefined && card.slug !== undefined && ctx.interestSlugs.has(card.slug)) {
		score += INTEREST_BOOST;
	}
	return score;
}
