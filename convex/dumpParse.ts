import { isRealArticleTitle, isQualityTopic } from './topicsLogic';

/**
 * Parse one Wikimedia hourly pageview dump line: `domain_code page_title count total_bytes`.
 * Keeps only `en` (en.wikipedia main namespace) articles passing the quality gates.
 * Returns the title as-is from the dump (underscored); null otherwise.
 */
export function parsePageviewLine(line: string): { title: string; views: number } | null {
	const parts = line.split(' ');
	if (parts.length < 3) return null;
	const [domain, title, countRaw] = parts;
	if (domain !== 'en' || title === undefined) return null;
	const views = Number(countRaw);
	if (!Number.isFinite(views) || views <= 0) return null;
	if (!isRealArticleTitle(title) || !isQualityTopic(title)) return null;
	return { title, views };
}
