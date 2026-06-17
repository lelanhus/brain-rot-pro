import { query } from './_generated/server';
import { v } from 'convex/values';
import { assertAdmin } from './adminAuth';
import { bucketByStatus, bucketByType, summarizeAudience, summarizeEngagement } from './adminLogic';

/**
 * Admin analytics overview (ADR-009). One gated read that folds the current
 * state of the product into a dashboard payload: content pipeline, audience,
 * engagement (CCR), and monetization. Admin-only and infrequent, so full table
 * reads are acceptable here (same trade-off as `metrics.ts`); behind the
 * Aggregate component when the user base grows.
 */
export const overview = query({
	args: { token: v.string() },
	returns: v.object({
		content: v.object({
			byStatus: v.record(v.string(), v.number()),
			published: v.number(),
			sourceArticles: v.number(),
			cardsTotal: v.number()
		}),
		audience: v.object({
			devices: v.number(),
			activeToday: v.number(),
			saves: v.number(),
			maxStreak: v.number(),
			avgCurrentStreak: v.number()
		}),
		engagement: v.object({
			totalEvents: v.number(),
			impressions: v.number(),
			continuations: v.number(),
			ccr: v.number(),
			byType: v.record(v.string(), v.number())
		}),
		monetization: v.object({
			impressions: v.number(),
			clicks: v.number(),
			ctr: v.number()
		})
	}),
	handler: async (ctx, args) => {
		assertAdmin(args.token);

		const cards = await ctx.db.query('knowledgeCards').collect();
		const sourceArticles = await ctx.db.query('sourceArticles').collect();
		const saved = await ctx.db.query('savedCards').collect();
		const stats = await ctx.db.query('deviceStats').collect();
		const events = await ctx.db.query('events').collect();

		const byStatus = bucketByStatus(cards);
		const byType = bucketByType(events);
		const engagement = summarizeEngagement(byType);
		const audience = summarizeAudience(stats, Date.now());

		const adImpressions = byType['sponsored_impression'] ?? 0;
		const adClicks = byType['sponsored_click'] ?? 0;

		return {
			content: {
				byStatus,
				published: byStatus['published'] ?? 0,
				sourceArticles: sourceArticles.length,
				cardsTotal: cards.length
			},
			audience: { ...audience, saves: saved.length },
			engagement: {
				totalEvents: events.length,
				impressions: engagement.impressions,
				continuations: engagement.continuations,
				ccr: engagement.ccr,
				byType
			},
			monetization: {
				impressions: adImpressions,
				clicks: adClicks,
				ctr: adImpressions === 0 ? 0 : adClicks / adImpressions
			}
		};
	}
});
