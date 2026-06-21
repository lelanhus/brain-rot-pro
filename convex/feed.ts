import { query } from './_generated/server';
import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { scoreCard } from './profileLogic';

/**
 * Unseen feed (never-repeat at scale). Paginates published cards, HARD-EXCLUDES
 * cards in seenCards + the profile's notInterested, then ranks the surviving
 * page (light concept-affinity now; swap rankPage for AI scoring later). Never
 * collect()s all cards. Seen is the source of truth in seenCards (ADR-007).
 */
export const unseen = query({
	args: {
		deviceId: v.string(),
		paginationOpts: paginationOptsValidator,
		focusConcept: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const profile =
			args.deviceId.length === 0
				? null
				: await ctx.db
						.query('userProfiles')
						.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
						.unique();
		const weights: Record<string, number> = {};
		for (const { concept, weight } of profile?.conceptWeights ?? []) weights[concept] = weight;
		const notInterested = new Set((profile?.notInterested ?? []).map(String));

		const page = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.paginate(args.paginationOpts);

		const unseenCards = [];
		for (const card of page.page) {
			if (notInterested.has(card._id)) continue;
			if (args.deviceId.length > 0) {
				const seen = await ctx.db
					.query('seenCards')
					.withIndex('by_device_card', (q) =>
						q.eq('deviceId', args.deviceId).eq('cardId', card._id)
					)
					.unique();
				if (seen !== null) continue;
			}
			unseenCards.push(card);
		}

		unseenCards.sort(
			(a, b) =>
				scoreCard(b.conceptTags, weights, {
					shuffleKey: b.shuffleKey,
					focusConcept: args.focusConcept
				}) -
				scoreCard(a.conceptTags, weights, {
					shuffleKey: a.shuffleKey,
					focusConcept: args.focusConcept
				})
		);

		return { ...page, page: unseenCards };
	}
});
