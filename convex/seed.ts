import { internalMutation } from './_generated/server';
import { seedCards } from './seedData';

/**
 * Seed (or re-seed) the Phase-0 card library. Internal — run with:
 *   npx convex run seed:seed
 * Idempotent: clears existing cards, then inserts the curated set. `shuffleKey`
 * is assigned here (in a mutation, where randomness is allowed) and persisted,
 * so the feed query stays deterministic (ADR-007).
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

		return { inserted: seedCards.length };
	}
});
