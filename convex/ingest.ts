import { action, internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { capText, looksLikeArticleTitle, stripCategoryPrefix, toParagraphs } from './ingestUtils';
import { selectFreeImage, type CardImage, type RawImageInfo } from './imageLicense';
import { imageCandidates } from './imageCandidates';
import { classifyTopic, decideArticleStatus, type TopicClaims } from './wikidataLogic';
import { image as imageValidator } from './schema';

// Required by Wikimedia policy: descriptive UA with contact info (ADR-005).
const USER_AGENT =
	'BrainRotPro/0.1 (https://github.com/lelanhus/brain-rot-pro; leland.husband@gmail.com)';
const ACTION_API = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const PAGEVIEWS_API =
	'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia.org/all-access';

type WikiPage = {
	pageid?: number;
	title: string;
	missing?: boolean;
	fullurl?: string;
	canonicalurl?: string;
	extract?: string;
	categories?: { title: string }[];
	revisions?: { revid: number }[];
	pageimage?: string; // representative image file name (no namespace)
	images?: { title: string }[]; // all File: on the page, in page order (prop=images)
	pageprops?: { wikibase_item?: string }; // linked Wikidata QID
};

// P31/P279/P106 carry an entity ref ({id}); P18 (image) carries a filename string.
type WikidataClaim = { mainsnak?: { datavalue?: { value?: { id?: string } | string } } };

// Thumbnail width requested from Commons; matches the card's max-width.
const IMAGE_THUMB_WIDTH = 640;

/** Upsert an ingested article by stable pageId. Internal — called by the action. */
export const upsertArticle = internalMutation({
	args: {
		pageId: v.number(),
		title: v.string(),
		url: v.string(),
		revisionId: v.union(v.number(), v.null()),
		extract: v.string(),
		paragraphs: v.array(v.string()),
		categories: v.array(v.string()),
		image: v.optional(imageValidator),
		pageviews: v.optional(v.number()),
		status: v.union(v.literal('fetched'), v.literal('filtered_out'))
	},
	returns: v.id('sourceArticles'),
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('sourceArticles')
			.withIndex('by_pageId', (q) => q.eq('pageId', args.pageId))
			.unique();
		const doc = { ...args, fetchedAt: Date.now() };
		if (existing) {
			await ctx.db.patch(existing._id, doc);
			return existing._id;
		}
		return await ctx.db.insert('sourceArticles', doc);
	}
});

/** Published cards that have no image yet — the backfill work-list. */
export const imagelessPublished = internalQuery({
	args: { limit: v.number() },
	handler: async (ctx, { limit }) => {
		const cards = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.take(2000);
		return cards
			.filter((c) => !c.image)
			.slice(0, limit)
			.map((c) => ({ _id: c._id, title: c.source.articleTitle }));
	}
});

/** Patch a (now-cleared, free-licensed) image onto an existing card. */
export const setCardImage = internalMutation({
	args: { cardId: v.id('knowledgeCards'), image: imageValidator },
	handler: async (ctx, { cardId, image }) => {
		await ctx.db.patch(cardId, { image });
	}
});

/** GET JSON from a Wikimedia endpoint, degrading to null on any HTTP/parse error. */
async function getJsonOrNull<T>(apiUrl: string, params: URLSearchParams): Promise<T | null> {
	try {
		const res = await fetch(`${apiUrl}?${params}`, { headers: { 'User-Agent': USER_AGENT } });
		if (!res.ok) return null;
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

async function fetchArticle(title: string): Promise<WikiPage | null> {
	const params = new URLSearchParams({
		action: 'query',
		format: 'json',
		formatversion: '2',
		prop: 'extracts|info|categories|revisions|pageimages|pageprops|images',
		inprop: 'url',
		explaintext: '1',
		exlimit: '1',
		rvprop: 'ids',
		rvlimit: '1',
		cllimit: '50',
		imlimit: '40', // candidate images on the page, in page order (filtered later)
		clshow: '!hidden', // content categories only — skip maintenance cats (year noise)
		piprop: 'name', // representative image file name; license fetched separately
		ppprop: 'wikibase_item', // the linked Wikidata QID, for the topic allowlist
		redirects: '1',
		titles: title
	});
	const res = await fetch(`${ACTION_API}?${params}`, { headers: { 'User-Agent': USER_AGENT } });
	if (!res.ok) throw new Error(`Action API ${res.status} for "${title}"`);
	const data = (await res.json()) as { query?: { pages?: WikiPage[] } };
	const page = data.query?.pages?.[0];
	if (!page || page.missing || !page.pageid) return null;
	return page;
}

/**
 * Fetch one Commons file's license metadata and clear it through the fail-closed
 * licensing check (ADR-005). Returns a ready-to-store `CardImage` only when the
 * license is provably free; otherwise `null` (no image is preferable to an
 * unlicensed one). Network/parse failures degrade to `null`.
 */
async function fetchCommonsImage(fileName: string | undefined): Promise<CardImage | null> {
	if (!fileName) return null;
	const params = new URLSearchParams({
		action: 'query',
		format: 'json',
		formatversion: '2',
		prop: 'imageinfo',
		iiprop: 'url|extmetadata',
		iiurlwidth: String(IMAGE_THUMB_WIDTH),
		iiextmetadatafilter:
			'License|LicenseShortName|LicenseUrl|Artist|Attribution|NonFree|Restrictions',
		titles: `File:${fileName}`
	});
	const data = await getJsonOrNull<{ query?: { pages?: { imageinfo?: RawImageInfo[] }[] } }>(
		ACTION_API,
		params
	);
	return selectFreeImage(data?.query?.pages?.[0]?.imageinfo?.[0]);
}

/**
 * Find the best free-licensed image for an article (ADR-005 image coverage): try
 * the lead image, then the Wikidata entity image (P18), then other images on the
 * page — each through the fail-closed gate — and keep the FIRST that clears.
 * Bounded by `imageCandidates`' cap so we make only a handful of license checks.
 * Returns `null` when nothing clears (the card simply ships without an image).
 */
async function fetchBestImage(
	page: WikiPage,
	wikidataImage: string | undefined
): Promise<CardImage | null> {
	const candidates = imageCandidates({
		leadImage: page.pageimage,
		wikidataImage,
		pageImages: (page.images ?? []).map((i) => i.title)
	});
	for (const fileName of candidates) {
		const cleared = await fetchCommonsImage(fileName);
		if (cleared) return cleared;
	}
	return null;
}

/**
 * Fetch the Wikidata `instance of` / `subclass of` / `occupation` claims for a
 * QID (for the topic allowlist, `classifyTopic`) plus the entity's `image` (P18,
 * a Commons filename) for image coverage. Returns null on any failure so
 * ingestion degrades to the category heuristic rather than aborting.
 */
async function fetchWikidataClaims(
	qid: string
): Promise<(TopicClaims & { image?: string }) | null> {
	const params = new URLSearchParams({
		action: 'wbgetentities',
		format: 'json',
		ids: qid,
		props: 'claims'
	});
	const data = await getJsonOrNull<{
		entities?: Record<string, { claims?: Record<string, WikidataClaim[]> }>;
	}>(WIKIDATA_API, params);
	const claims = data?.entities?.[qid]?.claims;
	if (!claims) return null;
	const ids = (prop: string): string[] =>
		(claims[prop] ?? [])
			.map((c) => c.mainsnak?.datavalue?.value)
			.map((val) => (val && typeof val === 'object' ? val.id : undefined))
			.filter((v): v is string => !!v);
	const p18 = claims['P18']?.[0]?.mainsnak?.datavalue?.value;
	const image = typeof p18 === 'string' ? p18 : undefined;
	return { instanceOf: ids('P31'), subclassOf: ids('P279'), occupations: ids('P106'), image };
}

/**
 * Ingest specific article titles. Public dev tooling (runnable via `convex run`).
 * Per-title failures are collected and returned, not thrown, so one bad title
 * doesn't abort the batch.
 *   npx convex run ingest:ingestTitles '{"titles":["Roman concrete","Octopus"]}'
 */
export const ingestTitles = action({
	args: { titles: v.array(v.string()) },
	handler: async (ctx, args) => {
		let ingested = 0;
		const skipped: string[] = [];
		const filtered: string[] = [];
		const errors: { title: string; error: string }[] = [];
		// Why each title was accepted/filtered (wikidata verdict vs heuristic) — for
		// tuning the allowlist from `convex run`.
		const decisions: { title: string; status: string; basis: string }[] = [];

		for (const title of args.titles) {
			if (!looksLikeArticleTitle(title)) {
				skipped.push(title);
				continue;
			}
			try {
				const page = await fetchArticle(title);
				if (!page || !page.extract) {
					errors.push({ title, error: 'no extract / missing page' });
					continue;
				}
				const categories = (page.categories ?? []).map((c) => stripCategoryPrefix(c.title));
				// Positive Wikidata allowlist leads; the category heuristic is the
				// fallback for topics Wikidata doesn't classify (decideArticleStatus).
				const qid = page.pageprops?.wikibase_item;
				const claims = qid ? await fetchWikidataClaims(qid) : null;
				const verdict = claims ? classifyTopic(claims) : null;
				const { status, basis } = decideArticleStatus({ verdict, categories });
				decisions.push({ title: page.title, status, basis });
				const accepted = status === 'fetched';
				// Only spend the image request on articles we'd actually generate from.
				const leadImage = accepted ? await fetchBestImage(page, claims?.image) : null;
				await ctx.runMutation(internal.ingest.upsertArticle, {
					pageId: page.pageid!,
					title: page.title,
					url:
						page.canonicalurl ??
						page.fullurl ??
						`https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
					revisionId: page.revisions?.[0]?.revid ?? null,
					extract: capText(page.extract),
					paragraphs: toParagraphs(page.extract),
					categories,
					image: leadImage ?? undefined,
					status
				});
				if (accepted) ingested++;
				else filtered.push(page.title);
			} catch (err) {
				errors.push({ title, error: err instanceof Error ? err.message : String(err) });
			}
		}
		return { ingested, filtered, skipped, errors, decisions };
	}
});

/**
 * Ingest a SINGLE title and return its articleId — the unit of work the
 * demand-driven Workpool enqueues. Mirrors one iteration of `ingestTitles`:
 * fetch → Wikidata/category topic gate → fail-closed Commons lead image →
 * upsert. `accepted` is false when the topic was filtered out (no card should
 * be generated). Returns `articleId` only when accepted, so the caller can chain
 * straight into generation.
 */
export const ingestOne = internalAction({
	args: { title: v.string() },
	handler: async (
		ctx,
		{ title }
	): Promise<{ articleId: Id<'sourceArticles'> | null; accepted: boolean }> => {
		if (!looksLikeArticleTitle(title)) return { articleId: null, accepted: false };
		const page = await fetchArticle(title);
		if (!page || !page.extract) return { articleId: null, accepted: false };
		const categories = (page.categories ?? []).map((c) => stripCategoryPrefix(c.title));
		const qid = page.pageprops?.wikibase_item;
		const claims = qid ? await fetchWikidataClaims(qid) : null;
		const verdict = claims ? classifyTopic(claims) : null;
		const { status } = decideArticleStatus({ verdict, categories });
		const accepted = status === 'fetched';
		const leadImage = accepted ? await fetchBestImage(page, claims?.image) : null;
		const articleId = await ctx.runMutation(internal.ingest.upsertArticle, {
			pageId: page.pageid!,
			title: page.title,
			url:
				page.canonicalurl ??
				page.fullurl ??
				`https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
			revisionId: page.revisions?.[0]?.revid ?? null,
			extract: capText(page.extract),
			paragraphs: toParagraphs(page.extract),
			categories,
			image: leadImage ?? undefined,
			status
		});
		return { articleId: accepted ? articleId : null, accepted };
	}
});

/**
 * Backfill images onto already-published cards that have none (ADR-005 coverage).
 * For each imageless card, re-fetch its source article and, if a free image now
 * clears the fail-closed gate (via the wider candidate search), patch it on.
 *   npx convex run ingest:backfillImages '{"limit":40}'
 */
export const backfillImages = action({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args): Promise<{ scanned: number; updated: number; titles: string[] }> => {
		const cards = await ctx.runQuery(internal.ingest.imagelessPublished, {
			limit: args.limit ?? 40
		});
		const titles: string[] = [];
		for (const card of cards) {
			const page = await fetchArticle(card.title);
			if (!page) continue;
			const qid = page.pageprops?.wikibase_item;
			const claims = qid ? await fetchWikidataClaims(qid) : null;
			const image = await fetchBestImage(page, claims?.image);
			if (image) {
				await ctx.runMutation(internal.ingest.setCardImage, { cardId: card._id, image });
				titles.push(card.title);
			}
		}
		return { scanned: cards.length, updated: titles.length, titles };
	}
});

/**
 * Search Wikipedia for article titles matching a concept (Action API
 * `list=search`, namespace 0, popularity-ranked). Powers demand-driven
 * generation: turn an in-demand concept into candidate articles to ingest.
 * Plain helper (no ctx) — callable directly inside an action.
 */
export async function searchArticleTitles(query: string, limit = 3): Promise<string[]> {
	const params = new URLSearchParams({
		action: 'query',
		format: 'json',
		formatversion: '2',
		list: 'search',
		srsearch: query,
		srlimit: String(limit),
		srnamespace: '0',
		srqiprofile: 'popular_inclinks_pv'
	});
	const data = await getJsonOrNull<{ query?: { search?: { title: string }[] } }>(
		ACTION_API,
		params
	);
	return (data?.query?.search ?? []).map((s) => s.title).filter(looksLikeArticleTitle);
}

/**
 * Fetch candidate titles from top-pageviews (design doc §8.2), filtered to
 * plausible articles. Returns titles for inspection / feeding ingestTitles.
 *   npx convex run ingest:topTitles '{"limit":20}'
 */
export const topTitles = action({
	args: { limit: v.optional(v.number()), daysAgo: v.optional(v.number()) },
	handler: async (_ctx, args) => {
		const limit = args.limit ?? 20;
		const when = new Date(Date.now() - (args.daysAgo ?? 2) * 86_400_000);
		const y = when.getUTCFullYear();
		const m = String(when.getUTCMonth() + 1).padStart(2, '0');
		const d = String(when.getUTCDate()).padStart(2, '0');

		const res = await fetch(`${PAGEVIEWS_API}/${y}/${m}/${d}`, {
			headers: { 'User-Agent': USER_AGENT }
		});
		if (!res.ok) throw new Error(`Pageviews API ${res.status}`);
		const data = (await res.json()) as {
			items?: { articles?: { article: string; views: number }[] }[];
		};
		const articles = data.items?.[0]?.articles ?? [];
		return articles
			.map((a) => ({ title: a.article.replace(/_/g, ' '), views: a.views }))
			.filter((a) => looksLikeArticleTitle(a.title))
			.slice(0, limit);
	}
});
