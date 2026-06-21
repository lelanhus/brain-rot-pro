import { internalMutation, internalQuery, query } from './_generated/server';
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

/** Topics ordered by popularity — curation suggestions + generation priority. */
export const topByPageviews = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) =>
		await ctx.db.query('topics').withIndex('by_pageviews').order('desc').take(limit ?? 50)
});

/** Full-text title search over the catalog. Empty query returns nothing. */
export const search = query({
	args: { query: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, { query: q, limit }) => {
		const trimmed = q.trim();
		if (trimmed === '') return [];
		return await ctx.db
			.query('topics')
			.withSearchIndex('search_title', (s) => s.search('title', trimmed))
			.take(limit ?? 20);
	}
});

/** Most-popular topics that have no cards yet — the generation priority queue. */
export const needingCards = internalQuery({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) =>
		await ctx.db
			.query('topics')
			.withIndex('by_cardCount_pageviews', (q) => q.eq('cardCount', 0))
			.order('desc')
			.take(limit ?? 20)
});

/** Single topic lookup by slug. */
export const bySlug = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) =>
		await ctx.db
			.query('topics')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.unique()
});
