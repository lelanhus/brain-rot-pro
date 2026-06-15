import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

/**
 * Admin review queue (design doc §17, review §3.2). Generated cards land as
 * `needs_review` and only a human can publish them — nothing AI-generated
 * reaches the feed unreviewed.
 */

export const queue = query({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'needs_review'))
			.take(50);
		return rows.map((c) => ({
			_id: c._id,
			hook: c.hook,
			body: c.body,
			format: c.format,
			sourceSpan: c.source.sourceSpan,
			sourceUrl: c.source.articleUrl,
			supportScore: c.generation?.supportScore ?? null
		}));
	}
});

export const approve = mutation({
	args: { cardId: v.id('knowledgeCards') },
	returns: v.null(),
	handler: async (ctx, args) => {
		const card = await ctx.db.get(args.cardId);
		if (!card) throw new Error('card not found');
		if (card.status !== 'needs_review') {
			throw new Error(`can only approve needs_review cards (was ${card.status})`);
		}
		await ctx.db.patch(args.cardId, { status: 'published' });
		return null;
	}
});

export const reject = mutation({
	args: { cardId: v.id('knowledgeCards') },
	returns: v.null(),
	handler: async (ctx, args) => {
		const card = await ctx.db.get(args.cardId);
		if (!card) throw new Error('card not found');
		await ctx.db.patch(args.cardId, { status: 'suppressed' });
		return null;
	}
});
