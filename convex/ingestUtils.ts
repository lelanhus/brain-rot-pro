/**
 * Pure helpers for the Wikimedia ingestion adapter (ADR-005). Kept separate
 * from the network/action code so they can be unit-tested without a deployment.
 */

/** Titles to skip from top-pageviews (non-article namespaces and noise). */
const SKIP_PREFIXES = [
	'Special:',
	'Wikipedia:',
	'Portal:',
	'Help:',
	'Template:',
	'Category:',
	'File:',
	'Talk:',
	'User:'
];
const SKIP_EXACT = new Set(['Main Page', 'Main_Page', '-', 'Hyphen-minus']);

export function looksLikeArticleTitle(title: string): boolean {
	if (!title || SKIP_EXACT.has(title)) return false;
	return !SKIP_PREFIXES.some((p) => title.startsWith(p));
}

/** Split a plaintext extract into clean, reasonably-sized paragraphs for grounding. */
export function toParagraphs(
	extract: string,
	opts: { max?: number; minLen?: number } = {}
): string[] {
	const { max = 12, minLen = 40 } = opts;
	return extract
		.split(/\n+/)
		.map((p) => p.trim())
		.filter((p) => p.length >= minLen && !p.endsWith('=')) // drop blank lines & section headers
		.slice(0, max);
}

/** Wikipedia category titles come prefixed; strip it for storage/filtering. */
export function stripCategoryPrefix(category: string): string {
	return category.replace(/^Category:/, '');
}

/**
 * Category-keyword signals that an article is time-bound or low educational
 * density (the design doc §8.2 noise: current events, sports, entertainment).
 * Heuristic, not exhaustive: the positive Wikidata allowlist (`wikidataLogic.ts`)
 * now leads — this runs only as the fallback for topics it can't classify.
 */
const EXCLUDE_CATEGORY_KEYWORDS = [
	'footballers',
	'football clubs',
	'sportspeople',
	'olympic',
	'fifa',
	'premier league',
	'basketball players',
	'baseball players',
	'cricketers',
	'films',
	'television series',
	'television shows',
	'albums',
	'singles',
	'songs',
	'video games',
	'web series',
	'deaths in',
	'elections',
	'pornographic'
];

const EXCLUDE_YEAR_CATEGORY = /\b20(1[5-9]|2[0-9])\b/; // recent-year categories ~ current events

/**
 * Heuristic: is this article evergreen/educational enough to generate cards from?
 * The fallback behind the Wikidata allowlist — see `decideArticleStatus`.
 */
export function isEvergreenArticle(categories: string[]): boolean {
	const lowered = categories.map((c) => c.toLowerCase());
	if (lowered.some((c) => EXCLUDE_CATEGORY_KEYWORDS.some((k) => c.includes(k)))) return false;
	// Many recent-year categories indicate current events; exclude if several appear.
	const yearHits = lowered.filter((c) => EXCLUDE_YEAR_CATEGORY.test(c)).length;
	return yearHits < 2;
}

/** Cap stored text so a single article can't blow Convex document limits. */
export function capText(text: string, maxChars = 8000): string {
	return text.length <= maxChars ? text : text.slice(0, maxChars);
}
