import { paginationOptsValidator } from 'convex/server';
import { query } from './_generated/server';

/**
 * The feed (Phase 0/1). Reads a bounded, indexed candidate set — published cards
 * ordered by their stored `shuffleKey` — and paginates it. No full-table scan,
 * no in-query randomness (ADR-007). Ranking here is content-intrinsic; behavioral
 * ranking is deliberately dormant until there is a user base.
 *
 * Consumed via `convexLoadPaginated(api.cards.feed, {}, { initialNumItems })`
 * for SSR-to-live (no loading flash), then live updates after hydration.
 */
export const feed = query({
	args: { paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.order('asc')
			.paginate(args.paginationOpts);
	}
});
