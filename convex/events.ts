import { mutation } from './_generated/server';
import { v } from 'convex/values';
import { eventType } from './schema';

function e_ts(args: { events: { cardId?: unknown; ts: number }[] }, cardId: unknown): number {
	return args.events.filter((e) => e.cardId === cardId).reduce((max, e) => Math.max(max, e.ts), 0);
}

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
		// Fail fast on a malformed identity rather than writing orphan events.
		if (args.deviceId.length === 0 || args.sessionId.length === 0) {
			throw new Error('log: deviceId and sessionId are required');
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
		// Record seen (durable, idempotent) for the never-repeat guarantee.
		const SEEN_TYPES = new Set(['card_impression', 'card_complete', 'card_skip']);
		const seenCardIds = [
			...new Set(
				args.events.filter((e) => SEEN_TYPES.has(e.type) && e.cardId).map((e) => e.cardId!)
			)
		];
		await Promise.all(
			seenCardIds.map(async (cardId) => {
				const existing = await ctx.db
					.query('seenCards')
					.withIndex('by_device_card', (q) => q.eq('deviceId', args.deviceId).eq('cardId', cardId))
					.unique();
				if (!existing) {
					await ctx.db.insert('seenCards', {
						deviceId: args.deviceId,
						cardId,
						seenAt: e_ts(args, cardId)
					});
				}
			})
		);

		return { logged: args.events.length };
	}
});
