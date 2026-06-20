import { mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { ConvexError, v } from 'convex/values';
import { assertAdmin } from './adminAuth';
import { ctr } from './affiliateLogic';
import { cardStatus } from './schema';
import {
	bucketByStatus,
	bucketByType,
	dailyActivity,
	mergeAccountSummaries,
	summarizeAudience,
	summarizeEngagement
} from './adminLogic';

const ACTIVITY_DAYS = 14;

/**
 * Admin analytics overview (ADR-009). One gated read that folds the current
 * state of the product into a dashboard payload: content pipeline, audience,
 * engagement (CCR), and monetization. Admin-only and infrequent, so full table
 * reads are acceptable here; move behind the Aggregate component when the user
 * base grows.
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
		}),
		activity: v.array(
			v.object({ day: v.string(), impressions: v.number(), continuations: v.number() })
		)
	}),
	handler: async (ctx, args) => {
		assertAdmin(args.token);

		const cards = await ctx.db.query('knowledgeCards').collect();
		const sourceArticles = await ctx.db.query('sourceArticles').collect();
		const saved = await ctx.db.query('savedCards').collect();
		const stats = await ctx.db.query('deviceStats').collect();
		const events = await ctx.db.query('events').collect();

		const now = Date.now();
		const byStatus = bucketByStatus(cards);
		const byType = bucketByType(events);
		const engagement = summarizeEngagement(byType);
		const audience = summarizeAudience(stats, now);

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
				ctr: ctr(adClicks, adImpressions)
			},
			activity: dailyActivity(events, now, ACTIVITY_DAYS)
		};
	}
});

/** Account list (ADR-009 phase 2) — one row per device, most-recently-active first. */
export const accounts = query({
	args: { token: v.string() },
	returns: v.array(
		v.object({
			deviceId: v.string(),
			currentStreak: v.number(),
			longestStreak: v.number(),
			daysLearned: v.number(),
			lastActiveDay: v.string(),
			saves: v.number(),
			concepts: v.number(),
			notInterested: v.number()
		})
	),
	handler: async (ctx, args) => {
		assertAdmin(args.token);
		const stats = await ctx.db.query('deviceStats').collect();
		const profiles = await ctx.db.query('userProfiles').collect();
		const saved = await ctx.db.query('savedCards').collect();
		const savedCounts = new Map<string, number>();
		for (const s of saved) savedCounts.set(s.deviceId, (savedCounts.get(s.deviceId) ?? 0) + 1);
		return mergeAccountSummaries(stats, profiles, savedCounts).slice(0, 500);
	}
});

/** Single-account detail (ADR-009 phase 2): streak, top concepts, saves, recent events. */
export const account = query({
	args: { token: v.string(), deviceId: v.string() },
	returns: v.object({
		found: v.boolean(),
		stats: v.union(
			v.object({
				currentStreak: v.number(),
				longestStreak: v.number(),
				daysLearned: v.number(),
				lastActiveDay: v.string()
			}),
			v.null()
		),
		topConcepts: v.array(v.object({ concept: v.string(), weight: v.number() })),
		saved: v.array(v.object({ cardId: v.id('knowledgeCards'), hook: v.string() })),
		recentEvents: v.array(
			v.object({ type: v.string(), ts: v.number(), cardId: v.optional(v.id('knowledgeCards')) })
		)
	}),
	handler: async (ctx, args) => {
		assertAdmin(args.token);
		const profile = await ctx.db
			.query('userProfiles')
			.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
			.unique();
		const stats = await ctx.db
			.query('deviceStats')
			.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
			.unique();
		const savedRows = await ctx.db
			.query('savedCards')
			.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
			.collect();
		const recent = await ctx.db
			.query('events')
			.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
			.order('desc')
			.take(50);

		const saved = await Promise.all(
			savedRows.map(async (row) => {
				const card = await ctx.db.get(row.cardId);
				return { cardId: row.cardId, hook: card?.hook ?? '(deleted card)' };
			})
		);

		const topConcepts = [...(profile?.conceptWeights ?? [])]
			.sort((a, b) => b.weight - a.weight)
			.slice(0, 12);

		return {
			found: profile !== null || stats !== null || savedRows.length > 0,
			stats: stats
				? {
						currentStreak: stats.currentStreak,
						longestStreak: stats.longestStreak,
						daysLearned: stats.daysLearned,
						lastActiveDay: stats.lastActiveDay
					}
				: null,
			topConcepts,
			saved,
			recentEvents: recent.map((e) => ({ type: e.type, ts: e.ts, cardId: e.cardId }))
		};
	}
});

/** Card list/search for content moderation (ADR-009 phase 3). */
export const cards = query({
	args: { token: v.string(), status: v.optional(cardStatus), search: v.optional(v.string()) },
	returns: v.array(
		v.object({
			_id: v.id('knowledgeCards'),
			hook: v.string(),
			body: v.string(),
			format: v.string(),
			status: v.string(),
			supportScore: v.union(v.number(), v.null()),
			conceptTags: v.array(v.string()),
			createdAt: v.number()
		})
	),
	handler: async (ctx, args) => {
		assertAdmin(args.token);
		const rows = args.status
			? await ctx.db
					.query('knowledgeCards')
					.withIndex('by_status_shuffle', (q) => q.eq('status', args.status!))
					.take(200)
			: await ctx.db.query('knowledgeCards').order('desc').take(200);
		const needle = (args.search ?? '').trim().toLowerCase();
		return rows
			.filter((c) => needle === '' || c.hook.toLowerCase().includes(needle))
			.map((c) => ({
				_id: c._id,
				hook: c.hook,
				body: c.body,
				format: c.format,
				status: c.status,
				supportScore: c.generation?.supportScore ?? null,
				conceptTags: c.conceptTags,
				createdAt: c.createdAt
			}));
	}
});

/**
 * Moderate a card (ADR-009 phase 3): publish or suppress. Cards auto-publish via
 * the generation pipeline; this is the admin override for suppressing a bad card
 * or re-publishing a suppressed one. Publishing schedules the embedding so it
 * joins "more like this".
 */
export const setCardStatus = mutation({
	args: {
		token: v.string(),
		cardId: v.id('knowledgeCards'),
		status: v.union(v.literal('published'), v.literal('suppressed'))
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		assertAdmin(args.token);
		const card = await ctx.db.get(args.cardId);
		if (!card) throw new Error('setCardStatus: card not found');
		// Acceptance criteria §3.2: a validation_failed card must never be published,
		// even by an admin — its claim isn't entailed by its source. Suppress only.
		if (args.status === 'published' && card.status === 'validation_failed') {
			throw new ConvexError({
				code: 'invalid_transition',
				message: 'A validation_failed card cannot be published.'
			});
		}
		await ctx.db.patch(args.cardId, { status: args.status });
		if (args.status === 'published' && !card.embedding) {
			await ctx.scheduler.runAfter(0, internal.embeddings.embedCard, { cardId: args.cardId });
		}
		return null;
	}
});
