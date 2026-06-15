/**
 * Pure personalization scoring (ADR-007). Behavioral signals → concept weights,
 * and concept weights + novelty + seen-suppression → a card score. Separated
 * from Convex so it's unit-testable without a deployment.
 */

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
/** How hard to push already-seen cards down (kept, not removed, so the feed never empties). */
export const SEEN_PENALTY = 5;

export type WeightedEvent = { type: string; cardId?: string | null };

/** Accumulate concept weights from events, given each card's concept tags. */
export function accumulateWeights(
	events: ReadonlyArray<WeightedEvent>,
	tagsByCard: Record<string, string[]>
): Record<string, number> {
	const weights: Record<string, number> = {};
	for (const e of events) {
		if (!e.cardId) continue;
		const delta = EVENT_DELTA[e.type];
		if (!delta) continue;
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
	opts: { seen: boolean; shuffleKey: number }
): number {
	let score = 0;
	for (const tag of tags) score += weights[tag] ?? 0;
	score += WILDCARD_WEIGHT * opts.shuffleKey;
	if (opts.seen) score -= SEEN_PENALTY;
	return score;
}
