import { internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { toSlug, mergePageviews } from './topicsLogic';

/** Insert a topic or accumulate pageviews onto the existing row with this slug. */
export const upsertTopic = internalMutation({
	args: { title: v.string(), pageviews: v.number(), source: v.string() },
	handler: async (ctx, { title, pageviews, source }) => {
		const slug = toSlug(title);
		const existing = await ctx.db
			.query('topics')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.unique();
		const now = Date.now();
		if (existing !== null) {
			await ctx.db.patch(existing._id, {
				pageviews: mergePageviews(existing.pageviews, pageviews),
				updatedAt: now
			});
		} else {
			await ctx.db.insert('topics', { title, slug, pageviews, cardCount: 0, source, updatedAt: now });
		}
	}
});
