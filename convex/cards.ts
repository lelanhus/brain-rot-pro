import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { query } from './_generated/server';

/**
 * The global feed: the anonymous SSR baseline. Reads a bounded, indexed candidate
 * set — published cards ordered by their stored `shuffleKey` — and paginates it.
 * No full-table scan, no in-query randomness (ADR-007). Ranking here is
 * content-intrinsic by design; behavioral personalization is layered on by
 * `feed.personal`, which the page switches to once a device id resolves.
 *
 * Consumed via `convexLoadPaginated(api.cards.feed, {}, { initialNumItems })`
 * for SSR-to-live (no loading flash), then live updates after hydration.
 *
 * Order is `shuffleKey` DESCENDING — deliberately matching the baseline order
 * `feed.personal` produces for an empty profile (its wildcard term scores higher
 * `shuffleKey` first, sorted descending). If these disagree, the first card
 * visibly swaps the instant the personalized query resolves on hydration. Keep
 * them in lockstep (see feed.test.ts "no hydration flash").
 */
export const feed = query({
	args: { paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.order('desc')
			.paginate(args.paginationOpts);
	}
});

/**
 * A single card by id — for shareable deep links (`/c/[id]`). Returns null when
 * the id is missing or the card isn't published (so an unpublished/suppressed id
 * never leaks via a shared URL). SSR-loaded so link unfurlers get OG metadata.
 */
export const byId = query({
	args: { id: v.id('knowledgeCards') },
	handler: async (ctx, args) => {
		const card = await ctx.db.get(args.id);
		if (!card || card.status !== 'published') return null;
		return card;
	}
});
