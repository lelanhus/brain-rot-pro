import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { DISCLOSURE, ctr, tallyOfferEvents, type OfferNetwork } from './affiliateLogic';

/**
 * Sponsored "Go deeper" offers (ADR-008). `active` is a light query — it reads
 * only the small `affiliateOffers` table (never events/profile), so it respects
 * the ADR-007 rule that the feed read stays cheap and isn't invalidated by
 * volatile signals. Contextual matching to card tags happens client-side.
 */
export const active = query({
	args: {},
	returns: v.array(
		v.object({
			_id: v.id('affiliateOffers'),
			headline: v.string(),
			blurb: v.string(),
			imageUrl: v.optional(v.string()),
			cta: v.string(),
			url: v.string(),
			network: v.union(
				v.literal('bookshop'),
				v.literal('amazon'),
				v.literal('course'),
				v.literal('direct')
			),
			disclosure: v.string(),
			conceptTags: v.array(v.string()),
			weight: v.number()
		})
	),
	handler: async (ctx) => {
		const rows = await ctx.db
			.query('affiliateOffers')
			.withIndex('by_status', (q) => q.eq('status', 'active'))
			.collect();
		return rows.map((r) => ({
			_id: r._id,
			headline: r.headline,
			blurb: r.blurb,
			imageUrl: r.imageUrl,
			cta: r.cta,
			url: r.url,
			network: r.network,
			disclosure: r.disclosure,
			conceptTags: r.conceptTags,
			weight: r.weight
		}));
	}
});

const networkValidator = v.union(
	v.literal('bookshop'),
	v.literal('amazon'),
	v.literal('course'),
	v.literal('direct')
);

/**
 * CTR report for the admin page (ADR-008, phase B). Joins every offer (active +
 * paused) with its tallied sponsored events. Admin-only and non-reactive-critical,
 * so reading the events table here is fine — it does NOT touch the feed read
 * (ADR-007). Sponsored events are fetched via the `by_type` index, not a full scan.
 */
export const report = query({
	args: {},
	returns: v.object({
		offers: v.array(
			v.object({
				offerId: v.id('affiliateOffers'),
				headline: v.string(),
				network: networkValidator,
				status: v.union(v.literal('active'), v.literal('paused')),
				impressions: v.number(),
				clicks: v.number(),
				ctr: v.number()
			})
		),
		totals: v.object({ impressions: v.number(), clicks: v.number(), ctr: v.number() })
	}),
	handler: async (ctx) => {
		const offers = await ctx.db.query('affiliateOffers').collect();
		const impressions = await ctx.db
			.query('events')
			.withIndex('by_type', (q) => q.eq('type', 'sponsored_impression'))
			.collect();
		const clicks = await ctx.db
			.query('events')
			.withIndex('by_type', (q) => q.eq('type', 'sponsored_click'))
			.collect();

		const tally = tallyOfferEvents([...impressions, ...clicks]);

		const rows = offers
			.map((o) => {
				const t = tally.get(o._id) ?? { impressions: 0, clicks: 0 };
				return {
					offerId: o._id,
					headline: o.headline,
					network: o.network,
					status: o.status,
					impressions: t.impressions,
					clicks: t.clicks,
					ctr: ctr(t.clicks, t.impressions)
				};
			})
			.sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);

		const totImp = rows.reduce((s, r) => s + r.impressions, 0);
		const totClk = rows.reduce((s, r) => s + r.clicks, 0);
		return {
			offers: rows,
			totals: { impressions: totImp, clicks: totClk, ctr: ctr(totClk, totImp) }
		};
	}
});

/**
 * Add an offer — the "easy way to add an affiliate" entry point. Provide the
 * link, headline, blurb, and the concept tags it's relevant to; everything else
 * has a sensible default (the program's required disclosure is filled in from
 * the network unless overridden). Callable from the dashboard, a seed, or a
 * tiny admin form.
 */
export const add = mutation({
	args: {
		headline: v.string(),
		blurb: v.string(),
		url: v.string(),
		conceptTags: v.array(v.string()),
		cta: v.optional(v.string()),
		imageUrl: v.optional(v.string()),
		network: v.optional(networkValidator),
		disclosure: v.optional(v.string()),
		weight: v.optional(v.number())
	},
	returns: v.id('affiliateOffers'),
	handler: async (ctx, args) => {
		if (args.headline.trim().length === 0 || args.url.trim().length === 0) {
			throw new Error('add: headline and url are required');
		}
		if (args.conceptTags.length === 0) {
			throw new Error('add: at least one conceptTag is required so the offer can be matched');
		}
		const network: OfferNetwork = args.network ?? 'bookshop';
		return await ctx.db.insert('affiliateOffers', {
			headline: args.headline.trim(),
			blurb: args.blurb.trim(),
			url: args.url.trim(),
			cta: args.cta ?? 'Learn more',
			imageUrl: args.imageUrl,
			network,
			disclosure: args.disclosure ?? DISCLOSURE[network],
			conceptTags: args.conceptTags,
			weight: args.weight ?? 1,
			status: 'active',
			createdAt: Date.now()
		});
	}
});

/** Pause or re-activate an offer without deleting it (keeps reporting history). */
export const setStatus = mutation({
	args: {
		offerId: v.id('affiliateOffers'),
		status: v.union(v.literal('active'), v.literal('paused'))
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.patch(args.offerId, { status: args.status });
		return null;
	}
});
