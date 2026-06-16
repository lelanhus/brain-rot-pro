import { internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';

// V8-runtime DB access for the embedding pipeline (the action file is "use node"
// and can't run Convex queries/mutations directly).

export const getCard = internalQuery({
	args: { cardId: v.id('knowledgeCards') },
	handler: async (ctx, args) => ctx.db.get(args.cardId)
});

/** Published cards missing an embedding (for backfill). Bounded scan. */
export const publishedWithoutEmbedding = internalQuery({
	args: { limit: v.number() },
	handler: async (ctx, args) => {
		const cards = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.collect();
		return cards.filter((c) => !c.embedding).slice(0, args.limit);
	}
});

/** All published cards (fallback candidate pool for concept-overlap ranking). */
export const publishedCards = internalQuery({
	args: {},
	handler: async (ctx) => {
		return await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.collect();
	}
});

/** Fetch cards by id, preserving the given order and dropping any that vanished. */
export const getByIds = internalQuery({
	args: { ids: v.array(v.id('knowledgeCards')) },
	handler: async (ctx, args) => {
		const docs = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
		return docs.filter((d): d is Doc<'knowledgeCards'> => d !== null);
	}
});

export const patchEmbedding = internalMutation({
	args: { cardId: v.id('knowledgeCards'), embedding: v.array(v.float64()) },
	returns: v.null(),
	handler: async (ctx, args) => {
		// Only embed published cards; ignore one that changed state since scheduling.
		const card = await ctx.db.get(args.cardId);
		if (card && card.status === 'published') {
			await ctx.db.patch(args.cardId, { embedding: args.embedding });
		}
		return null;
	}
});
