import { internalAction, internalMutation, internalQuery, query } from './_generated/server';
import { v } from 'convex/values';
import { isRealArticleTitle, toSlug, mergePageviews } from './topicsLogic';
import { internal } from './_generated/api';

/** Insert a topic or accumulate pageviews onto the existing row with this slug. */
export const upsertTopic = internalMutation({
	args: { title: v.string(), pageviews: v.number(), source: v.string() },
	handler: async (ctx, { title, pageviews, source }) => {
		const slug = toSlug(title);
		const existing = await ctx.db
			.query('topics')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.unique();
		const now = Date.now();
		if (existing !== null) {
			await ctx.db.patch(existing._id, {
				pageviews: mergePageviews(existing.pageviews, pageviews),
				updatedAt: now
			});
		} else {
			await ctx.db.insert('topics', { title, slug, pageviews, cardCount: 0, source, updatedAt: now });
		}
	}
});

/** Topics ordered by popularity — curation suggestions + generation priority. */
export const topByPageviews = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) =>
		await ctx.db.query('topics').withIndex('by_pageviews').order('desc').take(limit ?? 50)
});

/** Full-text title search over the catalog. Empty query returns nothing. */
export const search = query({
	args: { query: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, { query: q, limit }) => {
		const trimmed = q.trim();
		if (trimmed === '') return [];
		return await ctx.db
			.query('topics')
			.withSearchIndex('search_title', (s) => s.search('title', trimmed))
			.take(limit ?? 20);
	}
});

/** Most-popular topics that have no cards yet — the generation priority queue. */
export const needingCards = internalQuery({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) =>
		await ctx.db
			.query('topics')
			.withIndex('by_cardCount_pageviews', (q) => q.eq('cardCount', 0))
			.order('desc')
			.take(limit ?? 20)
});

/** Single topic lookup by slug. */
export const bySlug = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) =>
		await ctx.db
			.query('topics')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.unique()
});

// Wikimedia top-pageviews endpoint + descriptive UA (Wikimedia policy, ADR-005).
const PAGEVIEWS_TOP =
	'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia.org/all-access';
const USER_AGENT =
	'BrainRotPro/0.1 (https://github.com/lelanhus/brain-rot-pro; leland.husband@gmail.com)';

const DAY_MS = 86_400_000;

/** ISO 'YYYY-MM-DD' (UTC) for a millisecond timestamp. */
function isoDate(ms: number): string {
	const dt = new Date(ms);
	const y = dt.getUTCFullYear();
	const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
	const d = String(dt.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

export const readCatalogState = internalQuery({
	args: {},
	handler: async (ctx) =>
		await ctx.db
			.query('catalogState')
			.withIndex('by_key', (q) => q.eq('key', 'global'))
			.unique()
});

export const setBackfillCursor = internalMutation({
	args: { date: v.string() },
	handler: async (ctx, { date }) => {
		const row = await ctx.db
			.query('catalogState')
			.withIndex('by_key', (q) => q.eq('key', 'global'))
			.unique();
		const now = Date.now();
		if (row !== null) await ctx.db.patch(row._id, { backfillCursorDate: date, updatedAt: now });
		else
			await ctx.db.insert('catalogState', {
				key: 'global',
				lastHarvestedDate: '',
				backfillCursorDate: date,
				updatedAt: now
			});
	}
});

export const setLastHarvested = internalMutation({
	args: { date: v.string() },
	handler: async (ctx, { date }) => {
		const row = await ctx.db
			.query('catalogState')
			.withIndex('by_key', (q) => q.eq('key', 'global'))
			.unique();
		const now = Date.now();
		if (row !== null) await ctx.db.patch(row._id, { lastHarvestedDate: date, updatedAt: now });
		else
			await ctx.db.insert('catalogState', {
				key: 'global',
				lastHarvestedDate: date,
				updatedAt: now
			});
	}
});

/** Fetch one day's top-1000, filter noise, upsert survivors. Throws on API error. */
export const harvestTopDay = internalAction({
	args: { date: v.string() }, // 'YYYY-MM-DD'
	handler: async (ctx, { date }): Promise<{ fetched: number; kept: number }> => {
		const [y, m, d] = date.split('-');
		const res = await fetch(`${PAGEVIEWS_TOP}/${y}/${m}/${d}`, {
			headers: { 'User-Agent': USER_AGENT }
		});
		if (!res.ok) throw new Error(`Pageviews API ${res.status} for ${date}`);
		const data = (await res.json()) as {
			items?: { articles?: { article: string; views: number }[] }[];
		};
		const articles = data.items?.[0]?.articles ?? [];
		let kept = 0;
		for (const a of articles) {
			if (!isRealArticleTitle(a.article)) continue;
			await ctx.runMutation(internal.topics.upsertTopic, {
				title: a.article,
				pageviews: a.views,
				source: 'wikipedia-top'
			});
			kept++;
		}
		return { fetched: articles.length, kept };
	}
});

/**
 * Bounded, resumable historical backfill. Walks backward `days` days from the
 * day before the stored cursor (or 2 days ago if none — pageview data lags
 * ~1–2 days), harvesting each and advancing the cursor only after a day
 * succeeds. On API failure `harvestTopDay` throws, the run stops, and the
 * cursor is preserved at the last success so the next run retries that day.
 */
export const backfillCatalog = internalAction({
	args: { days: v.optional(v.number()) },
	handler: async (ctx, { days }): Promise<{ harvested: number }> => {
		const state = await ctx.runQuery(internal.topics.readCatalogState, {});
		const startMs =
			state?.backfillCursorDate !== undefined && state.backfillCursorDate !== ''
				? Date.parse(`${state.backfillCursorDate}T00:00:00Z`) - DAY_MS
				: Date.now() - 2 * DAY_MS;
		const n = days ?? 30;
		let cursorMs = startMs;
		let harvested = 0;
		for (let i = 0; i < n; i++) {
			const date = isoDate(cursorMs);
			await ctx.runAction(internal.topics.harvestTopDay, { date });
			await ctx.runMutation(internal.topics.setBackfillCursor, { date });
			harvested++;
			cursorMs -= DAY_MS;
		}
		return { harvested };
	}
});

/** Cron entrypoint: harvest the most recently available day (data lags ~2 days). */
export const harvestRecent = internalAction({
	args: {},
	handler: async (ctx): Promise<void> => {
		const date = isoDate(Date.now() - 2 * DAY_MS);
		await ctx.runAction(internal.topics.harvestTopDay, { date });
		await ctx.runMutation(internal.topics.setLastHarvested, { date });
	}
});

/** Increment a topic's published-card count by one. No-op if the slug isn't catalogued. */
export const incrementCardCount = internalMutation({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const topic = await ctx.db
			.query('topics')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.unique();
		if (topic !== null) {
			await ctx.db.patch(topic._id, { cardCount: topic.cardCount + 1, updatedAt: Date.now() });
		}
	}
});

/**
 * One-time: seed `cardCount` from existing published cards by mapping each
 * card's source article title to a topic slug. Cards whose source isn't in the
 * catalog are skipped. Going forward, `cardCount` upkeep is owned by the
 * generation sub-project — this only backfills history.
 */
export const backfillCardCounts = internalMutation({
	args: {},
	handler: async (ctx): Promise<{ updated: number }> => {
		const cards = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.collect();
		const counts = new Map<string, number>();
		for (const c of cards) {
			const slug = toSlug(c.source.articleTitle);
			counts.set(slug, (counts.get(slug) ?? 0) + 1);
		}
		let updated = 0;
		const now = Date.now();
		for (const [slug, count] of counts) {
			const topic = await ctx.db
				.query('topics')
				.withIndex('by_slug', (q) => q.eq('slug', slug))
				.unique();
			if (topic !== null) {
				await ctx.db.patch(topic._id, { cardCount: count, updatedAt: now });
				updated++;
			}
		}
		return { updated };
	}
});
