import { mutation, type MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import {
	CODE_TTL_MS,
	generateCode,
	isExpired,
	isValidCodeFormat,
	normalizeCode
} from './syncLogic';
import { mergeStreakStates } from './streakLogic';

// Cap on events re-pointed when merging accounts: keeps the transaction bounded
// while preserving the recent signal that drives personalization (recompute reads
// these). Older events on the joining device are left behind, not migrated.
const EVENT_REPOINT_CAP = 1000;

/**
 * Merge the `from` device's account into `to` (cross-device sync adopt). Saves
 * union (dedup), recent events re-point so the surviving account's recompute sees
 * the combined history, streak stats merge, and the joining device's now-stale
 * profile is dropped (the client rebuilds `to`'s profile on next load). Bounded:
 * saves are bounded per device and events are capped.
 */
async function mergeAccounts(ctx: MutationCtx, from: string, to: string): Promise<void> {
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

	// Profile is derived; drop the joining device's and let the client's
	// recompute-on-load rebuild the target's from the combined events.
	const fromProfile = await ctx.db
		.query('userProfiles')
		.withIndex('by_device', (q) => q.eq('deviceId', from))
		.unique();
	if (fromProfile) await ctx.db.delete(fromProfile._id);
}

/**
 * Cross-device account sync (ADR-004). `createCode` mints a short-lived code for
 * the calling device; `redeem` hands the source device's id to a new device so
 * it adopts the same anonymous account (saves / streak / profile all key on that
 * id). Codes are single-use and expire fast — they grant account access.
 */

/** Mint a fresh sync code for this device, retiring any prior unredeemed one. */
export const createCode = mutation({
	args: { deviceId: v.string() },
	returns: v.object({ code: v.string(), expiresAt: v.number() }),
	handler: async (ctx, args) => {
		if (args.deviceId.length === 0) throw new Error('createCode: deviceId is required');

		// Retire this device's earlier live codes so only the newest works.
		const prior = await ctx.db
			.query('syncCodes')
			.filter((q) => q.eq(q.field('deviceId'), args.deviceId))
			.collect();
		await Promise.all(prior.filter((p) => !p.redeemedAt).map((p) => ctx.db.delete(p._id)));

		// Generate a code that isn't currently taken (collisions are astronomically
		// rare, but a live duplicate would be ambiguous, so guard against it).
		let code = generateCode();
		for (let i = 0; i < 5; i++) {
			const clash = await ctx.db
				.query('syncCodes')
				.withIndex('by_code', (q) => q.eq('code', code))
				.unique();
			if (!clash) break;
			code = generateCode();
		}

		const now = Date.now();
		const expiresAt = now + CODE_TTL_MS;
		await ctx.db.insert('syncCodes', { code, deviceId: args.deviceId, createdAt: now, expiresAt });
		return { code, expiresAt };
	}
});

/**
 * Redeem a code on a device: merges this device's account into the code's source
 * account and returns the source `deviceId` to adopt. Throws (loud, never silent)
 * on an unknown / expired / already-used code. Single-use. `deviceId` is the
 * redeeming device's current (anonymous) id, whose data is merged in.
 */
export const redeem = mutation({
	args: { code: v.string(), deviceId: v.string() },
	returns: v.object({ deviceId: v.string(), merged: v.boolean() }),
	handler: async (ctx, args) => {
		const code = normalizeCode(args.code);
		if (!isValidCodeFormat(code)) throw new Error('That code is not valid.');

		const row = await ctx.db
			.query('syncCodes')
			.withIndex('by_code', (q) => q.eq('code', code))
			.unique();
		if (!row) throw new Error('That code was not found.');
		if (row.redeemedAt) throw new Error('That code has already been used.');
		if (isExpired(row.expiresAt, Date.now())) throw new Error('That code has expired.');

		await ctx.db.patch(row._id, { redeemedAt: Date.now() });

		const target = row.deviceId; // the surviving account (showed the code)
		const joining = args.deviceId; // this device, merged in
		if (joining && joining !== target) {
			await mergeAccounts(ctx, joining, target);
			return { deviceId: target, merged: true };
		}
		return { deviceId: target, merged: false };
	}
});
