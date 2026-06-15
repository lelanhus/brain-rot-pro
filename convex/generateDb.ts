import { internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';
import { cardFormat } from './schema';

// DB access for the generation pipeline. Kept out of the "use node" action file
// because Convex queries/mutations must run in the V8 runtime, not Node.

export const getArticle = internalQuery({
	args: { articleId: v.id('sourceArticles') },
	handler: async (ctx, args) => ctx.db.get(args.articleId)
});

/** Insert a generated card as a draft (needs_review or validation_failed — never published directly). */
export const insertGeneratedCard = internalMutation({
	args: {
		hook: v.string(),
		body: v.string(),
		whyItMatters: v.optional(v.string()),
		format: cardFormat,
		conceptTags: v.array(v.string()),
		source: v.object({
			articleTitle: v.string(),
			articleUrl: v.string(),
			pageId: v.optional(v.number()),
			revisionId: v.union(v.number(), v.null()),
			sourceSpan: v.string()
		}),
		status: v.union(v.literal('needs_review'), v.literal('validation_failed')),
		generation: v.object({
			generationModel: v.string(),
			validationModel: v.string(),
			supportScore: v.number(),
			promptVersion: v.string(),
			sourceArticleId: v.id('sourceArticles'),
			generatedAt: v.number()
		})
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
