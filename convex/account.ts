import { mutation, internalMutation, type MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { requireDevice } from './deviceIdentity';

/**
 * Privacy: erase everything tied to an anonymous account (release gate —
 * data-delete cascade). The bounded tables go in the request; events (the only
 * unbounded one) are purged in scheduled batches so the transaction stays small.
 */

const EVENT_BATCH = 500;

/** Delete one batch of a device's events; reschedule itself while a full batch remains. */
async function purgeEvents(ctx: MutationCtx, deviceId: string): Promise<void> {
	const batch = await ctx.db
		.query('events')
		.withIndex('by_device', (q) => q.eq('deviceId', deviceId))
		.take(EVENT_BATCH);
	await Promise.all(batch.map((e) => ctx.db.delete(e._id)));
	if (batch.length === EVENT_BATCH) {
		await ctx.scheduler.runAfter(0, internal.account.purgeEventsBatch, { deviceId });
	}
}

export const purgeEventsBatch = internalMutation({
	args: { deviceId: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		await purgeEvents(ctx, args.deviceId);
		return null;
	}
});

/** Delete one batch of a device's seenCards; reschedule itself while a full batch remains. */
async function purgeSeen(ctx: MutationCtx, deviceId: string): Promise<void> {
	const batch = await ctx.db
		.query('seenCards')
		.withIndex('by_device', (q) => q.eq('deviceId', deviceId))
		.take(500);
	await Promise.all(batch.map((s) => ctx.db.delete(s._id)));
	if (batch.length === 500) {
		await ctx.scheduler.runAfter(0, internal.account.purgeSeenBatch, { deviceId });
	}
}

export const purgeSeenBatch = internalMutation({
	args: { deviceId: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		await purgeSeen(ctx, args.deviceId);
		return null;
	}
});

/** Erase all data for a device: saved cards, profile, streak, sync codes, events, seen history. */
export const deleteData = mutation({
	args: { deviceId: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireDevice(ctx, args.deviceId);

		const saved = await ctx.db
			.query('savedCards')
			.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
			.collect();
		const profile = await ctx.db
			.query('userProfiles')
			.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
			.unique();
		const stats = await ctx.db
			.query('deviceStats')
			.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
			.unique();
		const codes = await ctx.db
			.query('syncCodes')
			.filter((q) => q.eq(q.field('deviceId'), args.deviceId))
			.collect();

		await Promise.all([
			...saved.map((s) => ctx.db.delete(s._id)),
			...codes.map((c) => ctx.db.delete(c._id)),
			...(profile ? [ctx.db.delete(profile._id)] : []),
			...(stats ? [ctx.db.delete(stats._id)] : [])
		]);
		await purgeEvents(ctx, args.deviceId);
		await purgeSeen(ctx, args.deviceId);
		return null;
	}
});
