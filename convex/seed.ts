import { internalMutation } from './_generated/server';
import { internal } from './_generated/api';
import { seedCards } from './seedData';

/**
 * Seed (or re-seed) the Phase-0 card library. Run with:
 *   npx convex run seed:seed
 * Idempotent: clears existing cards, then inserts the curated set. `shuffleKey`
 * is assigned here (in a mutation, where randomness is allowed) and persisted,
 * so the feed query stays deterministic (ADR-007).
 *
 * Internal (no public surface): invoke via `npx convex run seed:seed` with a
 * deploy key — `convex run` reaches internal functions, but no client SDK can.
 * This closes the release gate that flagged a public, destructive re-seed
 * (acceptance-criteria.md release gates; docs/release-gates.md B2).
 */
export const seed = internalMutation({
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
		await ctx.scheduler.runAfter(0, internal.embeddings.backfillEmbeddings, {
			limit: seedCards.length
		});

		return { inserted: seedCards.length };
	}
});
