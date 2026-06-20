import { mutation } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { accumulateWeights } from './profileLogic';

const SEEN_EVENTS = new Set(['card_impression', 'card_complete', 'card_skip']);

/**
 * Rebuild this device's personalization profile from its events (ADR-007:
 * precompute, so the feed query reads one cheap doc instead of scanning events).
 * Idempotent; called on session start and after strong signals.
 */
export const recompute = mutation({
	args: { deviceId: v.string() },
	returns: v.object({ concepts: v.number(), seen: v.number(), notInterested: v.number() }),
	handler: async (ctx, args) => {
		if (args.deviceId.length === 0) throw new Error('recompute: deviceId is required');

		const events = await ctx.db
			.query('events')
			.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
			.collect();

		// Concept tags for every card referenced by an event (fetched in parallel).
		const cardIds = [
			...new Set(events.map((e) => e.cardId).filter((id): id is Id<'knowledgeCards'> => !!id))
		];
		const cards = await Promise.all(cardIds.map((id) => ctx.db.get(id)));
		const tagsByCard: Record<string, string[]> = {};
		for (const card of cards) {
			if (card) tagsByCard[card._id] = card.conceptTags;
		}

		const weights = accumulateWeights(events, tagsByCard);
		const seen = new Set<Id<'knowledgeCards'>>();
		const notInterested = new Set<Id<'knowledgeCards'>>();
		for (const e of events) {
			if (!e.cardId) continue;
			if (SEEN_EVENTS.has(e.type)) seen.add(e.cardId);
			if (e.type === 'not_interested') notInterested.add(e.cardId);
		}

		const profile = {
			deviceId: args.deviceId,
			conceptWeights: Object.entries(weights).map(([concept, weight]) => ({ concept, weight })),
			seen: [...seen],
			notInterested: [...notInterested],
			updatedAt: Date.now()
		};

		const existing = await ctx.db
			.query('userProfiles')
			.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
			.unique();
		if (existing) await ctx.db.patch(existing._id, profile);
		else await ctx.db.insert('userProfiles', profile);

		return {
			concepts: profile.conceptWeights.length,
			seen: profile.seen.length,
			notInterested: profile.notInterested.length
		};
	}
});
