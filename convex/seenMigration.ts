import { internalMutation } from './_generated/server';
import { v } from 'convex/values';

/** One-time: copy each userProfiles.seen[] into seenCards rows. Idempotent —
 * skips (device, card) pairs that already exist. Run repeatedly until
 * profilesScanned is 0 (paginate via limit). */
export const backfillSeen = internalMutation({
	args: { limit: v.number() },
	returns: v.object({ profilesScanned: v.number(), rowsInserted: v.number() }),
	handler: async (ctx, { limit }) => {
		const profiles = await ctx.db.query('userProfiles').take(limit);
		let rowsInserted = 0;
		for (const p of profiles) {
			for (const cardId of p.seen ?? []) {
				const existing = await ctx.db
					.query('seenCards')
					.withIndex('by_device_card', (q) => q.eq('deviceId', p.deviceId).eq('cardId', cardId))
					.unique();
				if (existing === null) {
					await ctx.db.insert('seenCards', { deviceId: p.deviceId, cardId, seenAt: p.updatedAt });
					rowsInserted++;
				}
			}
		}
		return { profilesScanned: profiles.length, rowsInserted };
	}
});
