import { v } from 'convex/values';
import { internalAction, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { classifySafety } from './safetyLogic';

/** Published cards with their source title + categories (categories from the linked article). */
export const listPublishedForSafety = internalQuery({
	args: {},
	handler: async (ctx) => {
		const cards = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.collect();
		const out: { cardId: Id<'knowledgeCards'>; title: string; categories: string[] }[] = [];
		for (const c of cards) {
			let categories: string[] = [];
			const articleId = c.generation?.sourceArticleId;
			if (articleId !== undefined) {
				const article = await ctx.db.get(articleId);
				categories = article?.categories ?? [];
			}
			out.push({ cardId: c._id, title: c.source.articleTitle, categories });
		}
		return out;
	}
});

/**
 * Re-classify every published card for safety (W4) and suppress the unsafe ones.
 * Dry-run (report only) unless `apply: true`. Reversible (suppressed → published).
 *   bunx convex run safety:backfillSafety               # report
 *   bunx convex run safety:backfillSafety '{"apply":true}'
 */
export const backfillSafety = internalAction({
	args: { apply: v.optional(v.boolean()), nowYear: v.optional(v.number()) },
	returns: v.object({
		scanned: v.number(),
		unsafe: v.number(),
		suppressed: v.number(),
		reasons: v.array(v.object({ title: v.string(), reason: v.string() }))
	}),
	handler: async (ctx, { apply, nowYear }) => {
		const rows = await ctx.runQuery(internal.safety.listPublishedForSafety, {});
		const unsafeIds: Id<'knowledgeCards'>[] = [];
		const reasons: { title: string; reason: string }[] = [];
		for (const r of rows) {
			const verdict = classifySafety({ categories: r.categories, title: r.title, nowYear });
			if (!verdict.safe) {
				unsafeIds.push(r.cardId);
				reasons.push({ title: r.title, reason: verdict.reason ?? 'unknown' });
			}
		}
		let suppressed = 0;
		if (apply === true && unsafeIds.length > 0) {
			suppressed = (await ctx.runMutation(internal.curation.suppressCards, { ids: unsafeIds }))
				.suppressed;
		}
		return { scanned: rows.length, unsafe: unsafeIds.length, suppressed, reasons };
	}
});
