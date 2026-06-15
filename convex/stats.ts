import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { advanceStreak, dayKey, type StreakState } from './streakLogic';

/**
 * Engagement stats: the daily streak + lifetime days-learned (design: retention
 * hook). Kept in its own table/module so the feed query (ADR-007) never reads
 * it. The HUD subscribes to `get`; the feed calls `recordActivity` once on
 * session start.
 */

const ZERO = { currentStreak: 0, longestStreak: 0, daysLearned: 0, lastActiveDay: '' };

/** Read a device's engagement stats. Returns zeros for a never-seen device. */
export const get = query({
	args: { deviceId: v.string() },
	returns: v.object({
		currentStreak: v.number(),
		longestStreak: v.number(),
		daysLearned: v.number(),
		lastActiveDay: v.string()
	}),
	handler: async (ctx, args) => {
		if (args.deviceId.length === 0) return ZERO;
		const row = await ctx.db
			.query('deviceStats')
			.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
			.unique();
		if (!row) return ZERO;
		return {
			currentStreak: row.currentStreak,
			longestStreak: row.longestStreak,
			daysLearned: row.daysLearned,
			lastActiveDay: row.lastActiveDay
		};
	}
});

/**
 * Register today's visit: advance (or start / reset) the streak. Idempotent
 * within a UTC day, so the client can call it freely on every session start.
 * Returns the new stats plus the `event` so the UI can celebrate an extension.
 */
export const recordActivity = mutation({
	args: { deviceId: v.string() },
	returns: v.object({
		currentStreak: v.number(),
		longestStreak: v.number(),
		daysLearned: v.number(),
		event: v.union(
			v.literal('started'),
			v.literal('same_day'),
			v.literal('extended'),
			v.literal('reset')
		)
	}),
	handler: async (ctx, args) => {
		if (args.deviceId.length === 0) throw new Error('recordActivity: deviceId is required');

		const existing = await ctx.db
			.query('deviceStats')
			.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
			.unique();

		const prev: StreakState | null = existing
			? {
					currentStreak: existing.currentStreak,
					longestStreak: existing.longestStreak,
					lastActiveDay: existing.lastActiveDay,
					daysLearned: existing.daysLearned
				}
			: null;

		const { state, event } = advanceStreak(prev, dayKey(Date.now()));

		if (event !== 'same_day') {
			const doc = { deviceId: args.deviceId, ...state, updatedAt: Date.now() };
			if (existing) await ctx.db.patch(existing._id, doc);
			else await ctx.db.insert('deviceStats', doc);
		}

		return {
			currentStreak: state.currentStreak,
			longestStreak: state.longestStreak,
			daysLearned: state.daysLearned,
			event
		};
	}
});
