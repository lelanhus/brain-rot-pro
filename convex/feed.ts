import { query } from './_generated/server';
import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { scoreByTaste } from './profileLogic';
import { toSlug } from './topicsLogic';
import { ownedDeviceOrEmpty } from './deviceIdentity';

/**
 * Unseen feed (never-repeat at scale). Paginates published cards, HARD-EXCLUDES
 * cards in seenCards + the profile's notInterested, then ranks the surviving
 * page by taste vector (cosine similarity + novelty) with concept-affinity
 * fallback for cold-start / un-embedded cards. Never collect()s all cards.
 * Seen is the source of truth in seenCards (ADR-007).
 */
export const unseen = query({
	args: {
		deviceId: v.string(),
		paginationOpts: paginationOptsValidator,
		focusConcept: v.optional(v.string()),
		threadFromCardId: v.optional(v.id('knowledgeCards'))
	},
	handler: async (ctx, args) => {
		// Personalize ONLY for the caller's own device (B1). A forged or absent id
		// resolves to '' → the anonymous/global feed path below, never another
		// user's. Soft (no throw) so SSR of the first card stays session-free.
		const me = await ownedDeviceOrEmpty(ctx, args.deviceId);
		const profile =
			me.length === 0
				? null
				: await ctx.db
						.query('userProfiles')
						.withIndex('by_device', (q) => q.eq('deviceId', me))
						.unique();
		const weights: Record<string, number> = {};
		for (const { concept, weight } of profile?.conceptWeights ?? []) weights[concept] = weight;
		const notInterested = new Set((profile?.notInterested ?? []).map(String));

		const interestSlugs = new Set<string>();
		if (me.length > 0) {
			const ints = await ctx.db
				.query('interests')
				.withIndex('by_device', (q) => q.eq('deviceId', me))
				.collect();
			for (const i of ints) interestSlugs.add(i.slug);
		}

		let threadEmbedding: number[] | undefined;
		if (args.threadFromCardId !== undefined) {
			const tc = await ctx.db.get(args.threadFromCardId);
			threadEmbedding = tc?.embedding;
		}

		const page = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.paginate(args.paginationOpts);

		// Pages may come back sparse or even empty because seen/notInterested cards
		// are filtered out WITHIN each paginated page — the Convex cursor still
		// advances past them, so no unseen card is ever skipped and the loop can't
		// cycle. The client relies on repeated loadMore() calls to drain sparse pages.
		const unseenCards: typeof page.page = [];
		for (const card of page.page) {
			if (notInterested.has(card._id)) continue;
			if (me.length > 0) {
				const seen = await ctx.db
					.query('seenCards')
					.withIndex('by_device_card', (q) => q.eq('deviceId', me).eq('cardId', card._id))
					.unique();
				if (seen !== null) continue;
			}
			unseenCards.push(card);
		}

		const tasteVector = profile?.tasteVector;
		unseenCards.sort(
			(a, b) =>
				scoreByTaste(
					{
						conceptTags: b.conceptTags,
						embedding: b.embedding,
						slug: toSlug(b.source.articleTitle)
					},
					{
						tasteVector,
						weights,
						shuffleKey: b.shuffleKey,
						focusConcept: args.focusConcept,
						interestSlugs,
						threadEmbedding
					}
				) -
				scoreByTaste(
					{
						conceptTags: a.conceptTags,
						embedding: a.embedding,
						slug: toSlug(a.source.articleTitle)
					},
					{
						tasteVector,
						weights,
						shuffleKey: a.shuffleKey,
						focusConcept: args.focusConcept,
						interestSlugs,
						threadEmbedding
					}
				)
		);

		return { ...page, page: unseenCards };
	}
});
