/**
 * Dwell (ms) above which an impression counts as `card_complete` rather than
 * `card_skip`. Scales with body length (a longer card earns more time) but is
 * clamped so the feed stays fast. The CCR north-star metric this feeds is
 * computed server-side (see `adminLogic.summarizeEngagement`).
 */
export function dwellThresholdMs(body: string): number {
	const words = body.trim().split(/\s+/).filter(Boolean).length;
	return Math.min(4000, Math.max(1200, words * 60));
}
