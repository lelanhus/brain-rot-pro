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

type ProfileLite = {
	deviceId: string;
	conceptWeights: ReadonlyArray<unknown>;
	seen: ReadonlyArray<unknown>;
	notInterested: ReadonlyArray<unknown>;
};
type StatRowLite = {
	deviceId: string;
	currentStreak: number;
	longestStreak: number;
	daysLearned: number;
	lastActiveDay: string;
};
export type AccountSummary = {
	deviceId: string;
	currentStreak: number;
	longestStreak: number;
	daysLearned: number;
	lastActiveDay: string;
	saves: number;
	concepts: number;
	notInterested: number;
};

/**
 * Merge the per-device tables into one account row each, keyed by the union of
 * device ids seen across stats + profiles + saves (a device may have any subset).
 * Sorted most-recently-active first. Pure → testable without a deployment.
 */
export function mergeAccountSummaries(
	stats: ReadonlyArray<StatRowLite>,
	profiles: ReadonlyArray<ProfileLite>,
	savedCounts: ReadonlyMap<string, number>
): AccountSummary[] {
	const byDevice = new Map<string, AccountSummary>();
	const ensure = (deviceId: string): AccountSummary => {
		let row = byDevice.get(deviceId);
		if (!row) {
			row = {
				deviceId,
				currentStreak: 0,
				longestStreak: 0,
				daysLearned: 0,
				lastActiveDay: '',
				saves: savedCounts.get(deviceId) ?? 0,
				concepts: 0,
				notInterested: 0
			};
			byDevice.set(deviceId, row);
		}
		return row;
	};

	for (const s of stats) {
		const row = ensure(s.deviceId);
		row.currentStreak = s.currentStreak;
		row.longestStreak = s.longestStreak;
		row.daysLearned = s.daysLearned;
		row.lastActiveDay = s.lastActiveDay;
	}
	for (const p of profiles) {
		const row = ensure(p.deviceId);
		row.concepts = p.conceptWeights.length;
		row.notInterested = p.notInterested.length;
	}
	for (const deviceId of savedCounts.keys()) ensure(deviceId);

	return [...byDevice.values()].sort((a, b) => b.lastActiveDay.localeCompare(a.lastActiveDay));
}

/**
 * Daily impressions + continuations for the last `days` UTC days (oldest →
 * newest, zero-filled), for a simple activity trend. Buckets by `dayKey` so it
 * lines up with streak/active-today accounting.
 */
export function dailyActivity(
	events: ReadonlyArray<{ type: string; ts: number }>,
	now: number,
	days: number
): Array<{ day: string; impressions: number; continuations: number }> {
	const continuation = new Set(CONTINUATION_TYPES);
	const buckets = new Map<string, { impressions: number; continuations: number }>();
	const order: string[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const day = dayKey(now - i * 86_400_000);
		buckets.set(day, { impressions: 0, continuations: 0 });
		order.push(day);
	}
	for (const e of events) {
		const b = buckets.get(dayKey(e.ts));
		if (!b) continue; // outside the window
		if (e.type === 'card_impression') b.impressions++;
		else if (continuation.has(e.type)) b.continuations++;
	}
	return order.map((day) => ({ day, ...buckets.get(day)! }));
}
