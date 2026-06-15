import { internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';
import { cardFormat, generationValidator, image, sourceValidator } from './schema';

// DB access for the generation pipeline. Kept out of the "use node" action file
// because Convex queries/mutations must run in the V8 runtime, not Node.

export const getArticle = internalQuery({
	args: { articleId: v.id('sourceArticles') },
	handler: async (ctx, args) => ctx.db.get(args.articleId)
});

/**
 * Fetched articles that don't yet have a generated card. Small-scale scan
 * (fine for now; for a large library this would use a dedicated index/flag).
 */
export const articlesNeedingCards = internalQuery({
	args: { limit: v.number() },
	handler: async (ctx, args) => {
		const cards = await ctx.db.query('knowledgeCards').collect();
		const used = new Set(
			cards
				.map((c) => c.generation?.sourceArticleId)
				.filter((id): id is NonNullable<typeof id> => !!id)
		);
		const articles = await ctx.db.query('sourceArticles').collect();
		return articles
			.filter((a) => a.status === 'fetched' && !used.has(a._id))
			.slice(0, args.limit)
			.map((a) => a._id);
	}
});

/** Insert a generated card as a draft (needs_review or validation_failed — never published directly). */
export const insertGeneratedCard = internalMutation({
	args: {
		hook: v.string(),
		body: v.string(),
		whyItMatters: v.optional(v.string()),
		format: cardFormat,
		conceptTags: v.array(v.string()),
		source: sourceValidator,
		image: v.optional(image),
		status: v.union(v.literal('needs_review'), v.literal('validation_failed')),
		generation: generationValidator
	},
	returns: v.id('knowledgeCards'),
	handler: async (ctx, args) => {
		return await ctx.db.insert('knowledgeCards', {
			...args,
			shuffleKey: Math.random(),
			createdAt: Date.now()
		});
	}
});
