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

/** Cap stored text so a single article can't blow Convex document limits. */
export function capText(text: string, maxChars = 8000): string {
	return text.length <= maxChars ? text : text.slice(0, maxChars);
}
