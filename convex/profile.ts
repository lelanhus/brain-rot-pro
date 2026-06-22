import { mutation } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { accumulateWeights, buildTasteVector, meanCompleteDwell } from './profileLogic';

/**
 * Rebuild this device's personalization profile from its events (ADR-007:
 * precompute, so the feed query reads one cheap doc instead of scanning events).
 * Idempotent; called on session start and after strong signals.
 *
 * Note: `seen` is no longer written here — `seenCards` is the source of truth.
 */
export const recompute = mutation({
	args: { deviceId: v.string() },
	returns: v.object({ concepts: v.number(), notInterested: v.number() }),
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
		const embeddingByCard: Record<string, number[] | undefined> = {};
		for (const card of cards) {
			if (card) {
				tagsByCard[card._id] = card.conceptTags;
				embeddingByCard[card._id] = card.embedding;
			}
		}

		const userAvgDwell = meanCompleteDwell(events);
		const weights = accumulateWeights(events, tagsByCard, userAvgDwell);
		const notInterested = new Set<Id<'knowledgeCards'>>();
		for (const e of events) {
			if (e.cardId === undefined || e.cardId === null) continue;
			if (e.type === 'not_interested') notInterested.add(e.cardId);
		}
		const now = Date.now();
		const tasteVector = buildTasteVector(events, embeddingByCard, now, userAvgDwell);

		const profile = {
			deviceId: args.deviceId,
			conceptWeights: Object.entries(weights).map(([concept, weight]) => ({ concept, weight })),
			notInterested: [...notInterested],
			updatedAt: now
		};

		const existing = await ctx.db
			.query('userProfiles')
			.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
			.unique();
		if (existing) {
			// patch with tasteVector set-or-cleared (Convex removes a field set to undefined).
			await ctx.db.patch(existing._id, { ...profile, tasteVector });
		} else {
			await ctx.db.insert(
				'userProfiles',
				tasteVector !== undefined ? { ...profile, tasteVector } : profile
			);
		}

		return {
			concepts: profile.conceptWeights.length,
			notInterested: profile.notInterested.length
		};
	}
});
