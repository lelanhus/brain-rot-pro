import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { DISCLOSURE, type OfferNetwork } from './affiliateLogic';

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
