'use node';

import { action, internalAction } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { v } from 'convex/values';
import { embed, embedMany } from 'ai';
import { buildEmbeddingText, embeddingModel, relatedByConcepts } from './embedLogic';
import { requireGatewayKey } from './aiKey';
import { rateLimiter, rateLimitsDisabled, forCardKey, rateLimitedError } from './rateLimits';

// The embedding dimension is locked to the schema's vector index (1536).
// Overriding EMBEDDING_MODEL to a model with different dimensions requires a reindex.

/**
 * Embed one card and store the vector. Internal — scheduled when a card is published
 * when a card is published. No-op (silently) if the card is gone or unpublished
 * by the time it runs.
 */
export const embedCard = internalAction({
	args: { cardId: v.id('knowledgeCards') },
	returns: v.null(),
	handler: async (ctx, args) => {
		requireGatewayKey();
		const card = await ctx.runQuery(internal.embeddingsDb.getCard, { cardId: args.cardId });
		if (!card || card.status !== 'published') return null;

		const { embedding } = await embed({
			model: embeddingModel(),
			value: buildEmbeddingText(card)
		});
		await ctx.runMutation(internal.embeddingsDb.patchEmbedding, {
			cardId: args.cardId,
			embedding
		});
		return null;
	}
});

/**
 * Backfill embeddings for published cards that lack one (e.g. the seed library).
 *   npx convex run embeddings:backfillEmbeddings '{"limit":50}'
 */
export const backfillEmbeddings = internalAction({
	args: { limit: v.optional(v.number()) },
	returns: v.object({ embedded: v.number() }),
	handler: async (ctx, args): Promise<{ embedded: number }> => {
		requireGatewayKey();
		const cards = await ctx.runQuery(internal.embeddingsDb.publishedWithoutEmbedding, {
			limit: args.limit ?? 50
		});
		if (cards.length === 0) return { embedded: 0 };

		const { embeddings } = await embedMany({
			model: embeddingModel(),
			values: cards.map((c) => buildEmbeddingText(c))
		});
		await Promise.all(
			cards.map((c, i) =>
				ctx.runMutation(internal.embeddingsDb.patchEmbedding, {
					cardId: c._id,
					embedding: embeddings[i]
				})
			)
		);
		return { embedded: cards.length };
	}
});

/**
 * "More like this": the published cards most semantically similar to `cardId`.
 * Uses the vector index when the target has an embedding, and degrades to
 * concept-tag overlap otherwise — so it always returns *something* relevant,
 * even before backfill has run. Never includes the source card itself.
 *   npx convex run embeddings:forCard '{"cardId":"<id>"}'
 */
export const forCard = action({
	args: { cardId: v.id('knowledgeCards'), limit: v.optional(v.number()) },
	handler: async (ctx, args): Promise<Doc<'knowledgeCards'>[]> => {
		if (!rateLimitsDisabled()) {
			const identity = await ctx.auth.getUserIdentity();
			const { ok, retryAfter } = await rateLimiter.limit(ctx, 'forCard', {
				key: forCardKey(identity?.subject)
			});
			if (!ok) throw rateLimitedError(retryAfter);
		}
		const limit = args.limit ?? 3;
		const target = await ctx.runQuery(internal.embeddingsDb.getCard, { cardId: args.cardId });
		if (!target) return [];

		if (target.embedding) {
			const hits = await ctx.vectorSearch('knowledgeCards', 'by_embedding', {
				vector: target.embedding,
				limit: limit + 1, // +1 to absorb the target itself
				filter: (q) => q.eq('status', 'published')
			});
			const ids = hits.map((h) => h._id).filter((id) => id !== args.cardId);
			const cards = await ctx.runQuery(internal.embeddingsDb.getByIds, { ids });
			return cards.slice(0, limit);
		}

		// Fallback: concept-overlap ranking over the published pool.
		const pool = await ctx.runQuery(internal.embeddingsDb.publishedCards, {});
		return relatedByConcepts(target, pool, limit);
	}
});
