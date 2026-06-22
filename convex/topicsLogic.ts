// Pure helpers for the topic catalog — no Convex deps, unit-tested in isolation.

const SKIP_PREFIXES = [
	'Special:',
	'Wikipedia:',
	'Portal:',
	'Help:',
	'Template:',
	'Category:',
	'File:',
	'Talk:',
	'User:',
	'Draft:',
	'Module:',
	'MediaWiki:'
];
const SKIP_EXACT = new Set(['Main_Page', 'Main Page', '-']);

/**
 * True if a Wikipedia title is a real, catalog-worthy article (namespace 0,
 * not chrome, not a list/disambiguation/bare-number page). Fail-closed:
 * anything ambiguous is rejected to keep the catalog clean.
 */
export function isRealArticleTitle(title: string): boolean {
	const t = title.trim();
	if (t === '' || SKIP_EXACT.has(t)) return false;
	if (SKIP_PREFIXES.some((p) => t.startsWith(p))) return false;
	if (t.replace(/\s+/g, '_').startsWith('List_of_')) return false;
	if (/\(disambiguation\)/i.test(t)) return false;
	if (/^\d{1,4}$/.test(t)) return false; // bare years / numbers
	return true;
}

/**
 * Normalize a title to a stable dedupe/link key. Wikipedia treats spaces and
 * underscores interchangeably and is case-insensitive on the first letter, so
 * we lowercase and collapse whitespace/underscores.
 */
export function toSlug(title: string): string {
	return title
		.trim()
		.replace(/\s+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '')
		.toLowerCase();
}

/**
 * Cumulative popularity across harvested days. Sustained presence in the daily
 * top-1000 is itself signal, so we sum rather than take the max.
 */
export function mergePageviews(existing: number, incoming: number): number {
	return existing + incoming;
}

const TLD_RE = /^\.[a-z]{2,}$/i;
const DEATHS_RE = /^deaths?[\s_]+in[\s_]+\d/i;
const YEAR_IN_RE = /^\d{3,4}[\s_]+in[\s_]/i;

/**
 * Quality gate (stricter than the structural isRealArticleTitle): rejects clear
 * junk topic titles — TLDs (.xyz), "Deaths in …", and "YYYY in …" ranking pages.
 * Conservative: real subjects (people, places, films, year-prefix events) pass.
 */
export function isQualityTopic(title: string): boolean {
	const t = title.trim();
	if (TLD_RE.test(t)) return false;
	if (DEATHS_RE.test(t)) return false;
	if (YEAR_IN_RE.test(t)) return false;
	return true;
}
