import { mutation } from './_generated/server';
import { api } from './_generated/api';
import { seedCards } from './seedData';

/**
 * Seed (or re-seed) the Phase-0 card library. Run with:
 *   npx convex run seed:seed
 * Idempotent: clears existing cards, then inserts the curated set. `shuffleKey`
 * is assigned here (in a mutation, where randomness is allowed) and persisted,
 * so the feed query stays deterministic (ADR-007).
 *
 * Public so it can be invoked via `convex run` with a deploy key. This is a
 * dev-only seeding utility — gate it behind an admin check or remove it before
 * any external (non-Leland) user (acceptance-criteria.md release gates).
 */
export const seed = mutation({
	args: {},
	handler: async (ctx) => {
		const existing = await ctx.db.query('knowledgeCards').collect();
		for (const card of existing) {
			await ctx.db.delete(card._id);
		}

		const now = Date.now();
		for (const card of seedCards) {
			await ctx.db.insert('knowledgeCards', {
				...card,
				status: 'published',
				shuffleKey: Math.random(),
				createdAt: now
			});
		}

		// Backfill embeddings for the freshly-seeded library so "more like this"
		// uses vectors, not just concept overlap. Best-effort: no gateway key just
		// leaves them embedding-less (the fallback still works).
		await ctx.scheduler.runAfter(0, api.embeddings.backfillEmbeddings, { limit: seedCards.length });

		return { inserted: seedCards.length };
	}
});
