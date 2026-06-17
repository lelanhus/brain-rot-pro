import { dayKey } from './streakLogic';

/**
 * Pure aggregation for the admin analytics overview (ADR-009). Kept out of
 * Convex so the counting is unit-testable without a deployment, and so the
 * `admin.overview` query stays a thin "read tables → fold" shape. These fold
 * over full table reads today; for a real user base they move behind the
 * Aggregate component (same note as `metrics.ts`).
 */

// CCR continuation events — keep in sync with src/lib/metrics.ts (the
// unit-tested source of truth) and convex/metrics.ts.
export const CONTINUATION_TYPES = [
	'card_complete',
	'save',
	'card_expand',
	'source_open',
	'related_tap'
];

/** Tally a flat event list by `type`. */
export function bucketByType(events: ReadonlyArray<{ type: string }>): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
	return counts;
}

/** Impressions, continuations, and CCR derived from a by-type tally. */
export function summarizeEngagement(byType: Record<string, number>): {
	impressions: number;
	continuations: number;
	ccr: number;
} {
	const impressions = byType['card_impression'] ?? 0;
	const continuations = CONTINUATION_TYPES.reduce((sum, t) => sum + (byType[t] ?? 0), 0);
	return { impressions, continuations, ccr: impressions === 0 ? 0 : continuations / impressions };
}

/** Card-pipeline health: a count per lifecycle status. */
export function bucketByStatus(cards: ReadonlyArray<{ status: string }>): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const c of cards) counts[c.status] = (counts[c.status] ?? 0) + 1;
	return counts;
}

export type StreakStatLite = {
	currentStreak: number;
	longestStreak: number;
	lastActiveDay: string;
};

/**
 * Audience summary from per-device streak rows. "Active today" is by UTC day
 * (matching `streakLogic.dayKey`), so it lines up with how streaks are counted.
 */
export function summarizeAudience(
	stats: ReadonlyArray<StreakStatLite>,
	now: number
): { devices: number; activeToday: number; maxStreak: number; avgCurrentStreak: number } {
	const today = dayKey(now);
	let activeToday = 0;
	let maxStreak = 0;
	let sumCurrent = 0;
	for (const s of stats) {
		if (s.lastActiveDay === today) activeToday++;
		if (s.longestStreak > maxStreak) maxStreak = s.longestStreak;
		sumCurrent += s.currentStreak;
	}
	return {
		devices: stats.length,
		activeToday,
		maxStreak,
		avgCurrentStreak: stats.length === 0 ? 0 : sumCurrent / stats.length
	};
}
