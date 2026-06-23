import { v } from 'convex/values';
import { action, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

/** Every published card with its source article title (for re-classification). */
export const listPublishedSources = internalQuery({
	args: {},
	handler: async (ctx) => {
		const cards = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.collect();
		return cards.map((c) => ({ cardId: c._id, title: c.source.articleTitle }));
	}
});

/** Flip the given cards to the reversible `suppressed` status (out of the feed). */
export const suppressCards = internalMutation({
	args: { ids: v.array(v.id('knowledgeCards')) },
	handler: async (ctx, { ids }) => {
		for (const id of ids) await ctx.db.patch(id, { status: 'suppressed' });
		return { suppressed: ids.length };
	}
});

/**
 * Re-classify published cards by their source topic and (optionally) retire the
 * ephemeral ones. Dry-run unless `apply: true`. Public dev tooling, run via:
 *   npx convex run curation:auditEphemeralPublished          # report only
 *   npx convex run curation:auditEphemeralPublished '{"apply":true}'
 * Reversible: suppressed cards can be set back to 'published'.
 */
export const auditEphemeralPublished = action({
	args: { apply: v.optional(v.boolean()) },
	handler: async (ctx, { apply }) => {
		const sources = await ctx.runQuery(internal.curation.listPublishedSources, {});
		const byTitle = new Map<string, Id<'knowledgeCards'>[]>();
		for (const { cardId, title } of sources) {
			const list = byTitle.get(title);
			if (list !== undefined) list.push(cardId);
			else byTitle.set(title, [cardId]);
		}

		const ephemeralIds: Id<'knowledgeCards'>[] = [];
		const samples: { title: string; count: number }[] = [];
		for (const [title, ids] of byTitle) {
			const verdict = await ctx.runAction(internal.ingest.classifyTitle, { title });
			if (verdict?.ephemeral === true) {
				ephemeralIds.push(...ids);
				samples.push({ title, count: ids.length });
			}
		}

		const applied =
			apply === true
				? (await ctx.runMutation(internal.curation.suppressCards, { ids: ephemeralIds })).suppressed
				: 0;

		return {
			scanned: sources.length,
			distinctTopics: byTitle.size,
			wouldSuppress: ephemeralIds.length,
			applied,
			samples: samples.slice(0, 20)
		};
	}
});
