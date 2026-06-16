import { query } from './_generated/server';
import { v } from 'convex/values';
import { scoreCard } from './profileLogic';

/**
 * Personalized feed (ADR-007). Reads the precomputed profile (one cheap doc) +
 * the published cards, scores each by concept affinity + novelty − seen, drops
 * not-interested, and returns them ordered. Reads the profile, NOT raw events,
 * so logging events doesn't invalidate this query.
 *
 * Returns a bounded ordered array (the library is small in v1). When it grows,
 * this becomes a precomputed candidate pool + paginated read.
 */
export const personal = query({
	args: { deviceId: v.string(), focusConcept: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const cards = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.collect();

		const profile =
			args.deviceId.length === 0
				? null
				: await ctx.db
						.query('userProfiles')
						.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
						.unique();

		const weights: Record<string, number> = {};
		for (const { concept, weight } of profile?.conceptWeights ?? []) weights[concept] = weight;
		const seen = new Set((profile?.seen ?? []).map(String));
		const notInterested = new Set((profile?.notInterested ?? []).map(String));

		return cards
			.filter((c) => !notInterested.has(c._id))
			.map((c) => ({
				card: c,
				score: scoreCard(c.conceptTags, weights, {
					seen: seen.has(c._id),
					shuffleKey: c.shuffleKey,
					focusConcept: args.focusConcept
				})
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, 100)
			.map((s) => s.card);
	}
});
