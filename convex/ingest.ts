import { action, internalMutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { capText, looksLikeArticleTitle, stripCategoryPrefix, toParagraphs } from './ingestUtils';
import { selectFreeImage, type CardImage, type RawImageInfo } from './imageLicense';
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
	pageprops?: { wikibase_item?: string }; // linked Wikidata QID
};

type WikidataClaim = { mainsnak?: { datavalue?: { value?: { id?: string } } } };

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

/** Dev query: summarize ingested articles to verify provenance was captured. */
export const recent = query({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query('sourceArticles').order('desc').take(20);
		return rows.map((r) => ({
			_id: r._id,
			title: r.title,
			revisionId: r.revisionId,
			paragraphs: r.paragraphs.length,
			categories: r.categories.length,
			url: r.url,
			image: r.image ? `${r.image.licenseShortName} — ${r.image.author}` : null,
			firstParagraph: r.paragraphs[0]?.slice(0, 120) ?? ''
		}));
	}
});

async function fetchArticle(title: string): Promise<WikiPage | null> {
	const params = new URLSearchParams({
		action: 'query',
		format: 'json',
		formatversion: '2',
		prop: 'extracts|info|categories|revisions|pageimages|pageprops',
		inprop: 'url',
		explaintext: '1',
		exlimit: '1',
		rvprop: 'ids',
		rvlimit: '1',
		cllimit: '50',
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
 * Fetch the article's lead image with its Commons license metadata and clear it
 * through the fail-closed licensing check (ADR-005). Returns a ready-to-store
 * `CardImage` only when the license is provably free; otherwise `null` (no image
 * is preferable to an unlicensed one). Network/parse failures degrade to `null`
 * so a missing image never aborts ingestion of otherwise-good text.
 */
async function fetchLeadImage(fileName: string | undefined): Promise<CardImage | null> {
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
	try {
		const res = await fetch(`${ACTION_API}?${params}`, { headers: { 'User-Agent': USER_AGENT } });
		if (!res.ok) return null;
		const data = (await res.json()) as {
			query?: { pages?: { imageinfo?: RawImageInfo[] }[] };
		};
		const raw = data.query?.pages?.[0]?.imageinfo?.[0];
		return selectFreeImage(raw);
	} catch {
		return null;
	}
}

/**
 * Fetch the Wikidata `instance of` / `subclass of` / `occupation` claims for a
 * QID, for the topic allowlist (`classifyTopic`). Returns null on any failure so
 * ingestion degrades to the category heuristic rather than aborting.
 */
async function fetchWikidataClaims(qid: string): Promise<TopicClaims | null> {
	const params = new URLSearchParams({
		action: 'wbgetentities',
		format: 'json',
		ids: qid,
		props: 'claims'
	});
	try {
		const res = await fetch(`${WIKIDATA_API}?${params}`, { headers: { 'User-Agent': USER_AGENT } });
		if (!res.ok) return null;
		const data = (await res.json()) as {
			entities?: Record<string, { claims?: Record<string, WikidataClaim[]> }>;
		};
		const claims = data.entities?.[qid]?.claims;
		if (!claims) return null;
		const ids = (prop: string): string[] =>
			(claims[prop] ?? [])
				.map((c) => c.mainsnak?.datavalue?.value?.id)
				.filter((v): v is string => !!v);
		return { instanceOf: ids('P31'), subclassOf: ids('P279'), occupations: ids('P106') };
	} catch {
		return null;
	}
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
				const leadImage = accepted ? await fetchLeadImage(page.pageimage) : null;
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
