/**
 * Pure streak math (the daily-return hook). Kept out of Convex so it's
 * unit-testable without a deployment. Days are UTC date keys so a streak can't
 * be farmed by hopping timezones, and "same day" is idempotent — calling
 * advanceStreak twice in one day never double-counts.
 */

/** UTC calendar day for a timestamp, as a sortable `YYYY-MM-DD` key. */
export function dayKey(ts: number): string {
	return new Date(ts).toISOString().slice(0, 10);
}

/** Whole UTC days from `from` to `to` (both `YYYY-MM-DD`). Negative if `to` precedes `from`. */
export function dayDiff(from: string, to: string): number {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	return Math.round((b - a) / 86_400_000);
}

export type StreakState = {
	currentStreak: number;
	longestStreak: number;
	lastActiveDay: string;
	daysLearned: number;
};

/** What happened to the streak this visit — drives whether/how the UI celebrates. */
export type StreakEvent = 'started' | 'same_day' | 'extended' | 'reset';

/**
 * Fold today's visit into the prior streak state. First-ever visit → "started";
 * a second visit the same day → "same_day" (no change); the next calendar day →
 * "extended"; a gap of 2+ days → "reset" to 1. `daysLearned` (distinct active
 * days, lifetime) increments on every genuinely new day, never on a repeat.
 */
export function advanceStreak(
	prev: StreakState | null,
	today: string
): { state: StreakState; event: StreakEvent } {
	if (!prev || !prev.lastActiveDay) {
		return {
			state: { currentStreak: 1, longestStreak: 1, lastActiveDay: today, daysLearned: 1 },
			event: 'started'
		};
	}

	const gap = dayDiff(prev.lastActiveDay, today);
	if (gap <= 0) {
		// Same day (or a clock that went backwards) — idempotent, nothing changes.
		return { state: prev, event: 'same_day' };
	}

	const currentStreak = gap === 1 ? prev.currentStreak + 1 : 1;
	return {
		state: {
			currentStreak,
			longestStreak: Math.max(prev.longestStreak, currentStreak),
			lastActiveDay: today,
			daysLearned: prev.daysLearned + 1
		},
		event: gap === 1 ? 'extended' : 'reset'
	};
}
