import { mutation } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { eventType } from './schema';
import { requireDevice } from './deviceIdentity';

const SEEN_TYPES = new Set(['card_impression', 'card_complete', 'card_skip']);

/**
 * Batched, append-only event logging (design doc §11.3, §22.2). The client
 * buffers events and flushes them here; writes are fire-and-forget on the
 * client so the UI never blocks. The feed query never reads this table
 * (ADR-007). `deviceId` is the anonymous pre-auth identity.
 */
export const log = mutation({
	args: {
		deviceId: v.string(),
		sessionId: v.string(),
		events: v.array(
			v.object({
				type: eventType,
				cardId: v.optional(v.id('knowledgeCards')),
				offerId: v.optional(v.id('affiliateOffers')),
				visibleMs: v.optional(v.number()),
				ts: v.number()
			})
		)
	},
	returns: v.object({ logged: v.number() }),
	handler: async (ctx, args) => {
		// Trust the session, not the arg: the caller may only log as itself.
		await requireDevice(ctx, args.deviceId);
		if (args.sessionId.length === 0) {
			throw new Error('log: sessionId is required');
		}
		// Guard against a runaway client batch (Convex caps writes per txn anyway).
		if (args.events.length > 200) {
			throw new Error(`log: batch too large (${args.events.length} > 200)`);
		}

		await Promise.all(
			args.events.map((e) =>
				ctx.db.insert('events', {
					deviceId: args.deviceId,
					sessionId: args.sessionId,
					type: e.type,
					cardId: e.cardId,
					offerId: e.offerId,
					visibleMs: e.visibleMs,
					ts: e.ts
				})
			)
		);
		// Record seen (durable, idempotent) for the never-repeat guarantee. One pass
		// builds {cardId → max ts} over the seen-type events, deduping as it goes.
		const seenMax = new Map<Id<'knowledgeCards'>, number>();
		for (const e of args.events) {
			if (e.cardId === undefined || !SEEN_TYPES.has(e.type)) continue;
			seenMax.set(e.cardId, Math.max(seenMax.get(e.cardId) ?? 0, e.ts));
		}
		await Promise.all(
			[...seenMax].map(async ([cardId, seenAt]) => {
				const existing = await ctx.db
					.query('seenCards')
					.withIndex('by_device_card', (q) => q.eq('deviceId', args.deviceId).eq('cardId', cardId))
					.unique();
				if (existing === null) {
					await ctx.db.insert('seenCards', { deviceId: args.deviceId, cardId, seenAt });
				}
			})
		);

		return { logged: args.events.length };
	}
});
