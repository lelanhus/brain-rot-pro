import { internalMutation, type MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import { mergeStreakStates } from './streakLogic';

/**
 * Account merge (ADR-004). Folds one anonymous account's data into another. This
 * is the shared seam for joining accounts: `/sync` redeem uses it today, and
 * Better Auth's anonymous→social `onLinkAccount` will use the same path when auth
 * lands — one tested merge, not two. Kept provider-agnostic (operates on the
 * `deviceId` principal) so wiring Better Auth is a thin call, not a rewrite.
 */

// Cap on events re-pointed when merging: keeps the transaction bounded while
// preserving the recent signal that drives personalization (recompute reads
// these). Older events on the joining account are left behind, not migrated.
export const EVENT_REPOINT_CAP = 1000;

/**
 * Merge the `from` account into `to`. Saves union (dedup), recent events re-point
 * so the surviving account's recompute sees the combined history, streak stats
 * merge, and the joining account's now-stale profile is dropped (the client
 * rebuilds `to`'s profile on next load). Bounded: saves are bounded per device
 * and events are capped.
 */
export async function mergeAccounts(ctx: MutationCtx, from: string, to: string): Promise<void> {
	// Saved cards: union, dropping duplicates already saved on the target.
	const targetSaved = await ctx.db
		.query('savedCards')
		.withIndex('by_device', (q) => q.eq('deviceId', to))
		.collect();
	const targetCardIds = new Set(targetSaved.map((s) => String(s.cardId)));
	const fromSaved = await ctx.db
		.query('savedCards')
		.withIndex('by_device', (q) => q.eq('deviceId', from))
		.collect();
	for (const s of fromSaved) {
		if (targetCardIds.has(String(s.cardId))) await ctx.db.delete(s._id);
		else await ctx.db.patch(s._id, { deviceId: to });
	}

	// Events: re-point the most recent (capped) so recompute reflects both devices.
	const fromEvents = await ctx.db
		.query('events')
		.withIndex('by_device', (q) => q.eq('deviceId', from))
		.order('desc')
		.take(EVENT_REPOINT_CAP);
	for (const e of fromEvents) await ctx.db.patch(e._id, { deviceId: to });

	// Streak: merge into the target (or re-point if the target has none yet).
	const toStats = await ctx.db
		.query('deviceStats')
		.withIndex('by_device', (q) => q.eq('deviceId', to))
		.unique();
	const fromStats = await ctx.db
		.query('deviceStats')
		.withIndex('by_device', (q) => q.eq('deviceId', from))
		.unique();
	if (fromStats) {
		if (toStats) {
			await ctx.db.patch(toStats._id, {
				...mergeStreakStates(toStats, fromStats),
				updatedAt: Date.now()
			});
			await ctx.db.delete(fromStats._id);
		} else {
			await ctx.db.patch(fromStats._id, { deviceId: to });
		}
	}

	// Profile is derived; drop the joining account's and let the client's
	// recompute-on-load rebuild the target's from the combined events.
	const fromProfile = await ctx.db
		.query('userProfiles')
		.withIndex('by_device', (q) => q.eq('deviceId', from))
		.unique();
	if (fromProfile) await ctx.db.delete(fromProfile._id);
}

/**
 * Internal entry point for the merge — callable from other Convex functions
 * (sync redeem today; Better Auth `onLinkAccount` later). Internal, not public:
 * merging accounts is privileged and only triggered by a verified flow. No-op
 * when the two principals are the same.
 */
export const mergeInto = internalMutation({
	args: { from: v.string(), to: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		if (args.from && args.to && args.from !== args.to) {
			await mergeAccounts(ctx, args.from, args.to);
		}
		return null;
	}
});
