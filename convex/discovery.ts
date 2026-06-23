import { internalAction, internalQuery } from './_generated/server';
import { api, internal } from './_generated/api';
import { v } from 'convex/values';
import { toSlug } from './topicsLogic';
import { pickDiscoveries } from './discoveryLogic';

const ACTION_API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT =
	'BrainRotPro/0.1 (https://github.com/lelanhus/brain-rot-pro; leland.husband@gmail.com)';

/** Related article titles via MediaWiki morelike search. Best-effort: [] on any failure. */
async function relatedTitles(title: string): Promise<string[]> {
	try {
		const params = new URLSearchParams({
			action: 'query',
			list: 'search',
			srsearch: `morelike:${title}`,
			srlimit: '12',
			format: 'json',
			origin: '*'
		});
		const res = await fetch(`${ACTION_API}?${params.toString()}`, {
			headers: { 'User-Agent': USER_AGENT }
		});
		if (!res.ok) return [];
		const data = (await res.json()) as { query?: { search?: { title: string }[] } };
		return (data.query?.search ?? []).map((s) => s.title).filter((tt) => tt !== title);
	} catch {
		return [];
	}
}

/** Catalog rows for the given slugs (only those that exist). */
export const candidatesBySlugs = internalQuery({
	args: { slugs: v.array(v.string()) },
	handler: async (ctx, { slugs }) => {
		const out: { slug: string; title: string; pageviews: number }[] = [];
		for (const slug of slugs) {
			const row = await ctx.db
				.query('topics')
				.withIndex('by_slug', (q) => q.eq('slug', slug))
				.unique();
			if (row !== null && row.evergreen !== false)
				out.push({ slug: row.slug, title: row.title, pageviews: row.pageviews });
		}
		return out;
	}
});

/** Broaden interests: find catalog topics related to a just-followed topic and add the top 3 as 'discovered'. */
export const discoverFor = internalAction({
	args: { deviceId: v.string(), slug: v.string(), title: v.string() },
	handler: async (ctx, { deviceId, title }): Promise<{ discovered: number }> => {
		const titles = await relatedTitles(title);
		if (titles.length === 0) return { discovered: 0 };
		const slugs = titles.map(toSlug);
		const candidates = await ctx.runQuery(internal.discovery.candidatesBySlugs, { slugs });
		const followedRows = await ctx.runQuery(api.interests.list, { deviceId });
		const followed = new Set<string>(followedRows.map((i) => i.slug));
		const picks = pickDiscoveries(candidates, followed, 3);
		for (const p of picks) {
			await ctx.runMutation(internal.interests.addDiscovered, {
				deviceId,
				slug: p.slug,
				title: p.title.replace(/_/g, ' ')
			});
		}
		return { discovered: picks.length };
	}
});
