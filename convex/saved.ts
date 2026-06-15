import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

/**
 * Toggle a card's saved state for a device. Idempotent per (device, card):
 * returns the resulting saved state. Bounded reads via the by_device_card index.
 */
export const toggle = mutation({
	args: { deviceId: v.string(), cardId: v.id('knowledgeCards') },
	returns: v.object({ saved: v.boolean() }),
	handler: async (ctx, args) => {
		if (args.deviceId.length === 0) {
			throw new Error('toggle: deviceId is required');
		}
		const existing = await ctx.db
			.query('savedCards')
			.withIndex('by_device_card', (q) => q.eq('deviceId', args.deviceId).eq('cardId', args.cardId))
			.unique();

		if (existing) {
			await ctx.db.delete(existing._id);
			return { saved: false };
		}
		await ctx.db.insert('savedCards', {
			deviceId: args.deviceId,
			cardId: args.cardId,
			savedAt: Date.now()
		});
		return { saved: true };
	}
});

/** The set of card ids this device has saved (for marking saved state in the feed). */
export const savedIds = query({
	args: { deviceId: v.string() },
	returns: v.array(v.id('knowledgeCards')),
	handler: async (ctx, args) => {
		if (args.deviceId.length === 0) return [];
		const rows = await ctx.db
			.query('savedCards')
			.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
			.collect();
		return rows.map((r) => r.cardId);
	}
});

/** Saved cards with their content, newest first (for a /saved view). */
export const list = query({
	args: { deviceId: v.string() },
	handler: async (ctx, args) => {
		if (args.deviceId.length === 0) return [];
		const rows = await ctx.db
			.query('savedCards')
			.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
			.order('desc')
			.collect();

		const cards = [];
		for (const row of rows) {
			const card = await ctx.db.get(row.cardId);
			if (card) cards.push({ ...card, savedAt: row.savedAt });
		}
		return cards;
	}
});
