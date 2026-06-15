import { mutation } from './_generated/server';
import { v } from 'convex/values';
import { eventType } from './schema';

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
					visibleMs: e.visibleMs,
					ts: e.ts
				})
			)
		);
		return { logged: args.events.length };
	}
});
