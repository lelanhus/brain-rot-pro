/**
 * Curiosity Continuation Rate (CCR) — the north-star metric (review §4.3,
 * acceptance-criteria Phase 1). Definition fixed here and unit-tested so it's
 * unambiguous and computable from logged events.
 *
 * A card impression "continues" when it is followed by a meaningful positive
 * interaction. `card_complete` already encodes the dwell threshold (the client
 * decides complete-vs-skip via `dwellThresholdMs`), so dwell is folded in here.
 *
 * Thresholds are provisional and tunable after the Phase-0/1 content read.
 */
export const CONTINUATION_EVENTS = [
	'card_complete',
	'save',
	'card_expand',
	'source_open',
	'related_tap'
] as const;

/**
 * Dwell (ms) above which an impression counts as `card_complete` rather than
 * `card_skip`. Scales with body length (a longer card earns more time) but is
 * clamped so the feed stays fast.
 */
export function dwellThresholdMs(body: string): number {
	const words = body.trim().split(/\s+/).filter(Boolean).length;
	return Math.min(4000, Math.max(1200, words * 60));
}

export function isContinuation(type: string): boolean {
	return (CONTINUATION_EVENTS as readonly string[]).includes(type);
}

/** CCR = continuations / impressions, in [0, 1]. Returns 0 when no impressions. */
export function computeCcr(events: ReadonlyArray<{ type: string }>): number {
	const impressions = events.filter((e) => e.type === 'card_impression').length;
	if (impressions === 0) return 0;
	const continuations = events.filter((e) => isContinuation(e.type)).length;
	return continuations / impressions;
}
