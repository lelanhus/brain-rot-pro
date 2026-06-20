import { internalQuery } from './_generated/server';
import { v } from 'convex/values';

/**
 * Demand signal for generation (ADR-007 personalization output, reused). Sums
 * every device's `conceptWeights` into aggregate interest, then subtracts the
 * concepts the published library already covers well — so we generate toward
 * what people want AND are short on, not blindly. Deduped across users: one card
 * about a concept serves everyone interested in it (cards are shared facts, not
 * per-user content). This is the "as users need more / on new interests" input.
 */
const WELL_COVERED = 3; // a concept tagged on >= this many published cards is satisfied

export const topConcepts = internalQuery({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) => {
		const profiles = await ctx.db.query('userProfiles').take(1000);
		const demand = new Map<string, number>();
		for (const p of profiles) {
			for (const { concept, weight } of p.conceptWeights) {
				if (weight > 0) demand.set(concept, (demand.get(concept) ?? 0) + weight);
			}
		}

		const published = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.take(2000);
		const coverage = new Map<string, number>();
		for (const c of published) {
			for (const t of c.conceptTags) coverage.set(t, (coverage.get(t) ?? 0) + 1);
		}

		return [...demand.entries()]
			.map(([concept, weight]) => ({ concept, weight, covered: coverage.get(concept) ?? 0 }))
			.filter((d) => d.covered < WELL_COVERED)
			.sort((a, b) => b.weight - a.weight)
			.slice(0, limit ?? 5);
	}
});
