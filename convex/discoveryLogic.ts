/**
 * Pick up to `limit` discovery candidates: drop already-followed slugs, dedupe by
 * slug (first wins), rank by pageviews desc.
 */
export function pickDiscoveries(
	candidates: { slug: string; title: string; pageviews: number }[],
	followed: ReadonlySet<string>,
	limit: number
): { slug: string; title: string }[] {
	const bySlug = new Map<string, { slug: string; title: string; pageviews: number }>();
	for (const c of candidates) {
		if (followed.has(c.slug) || bySlug.has(c.slug)) continue;
		bySlug.set(c.slug, c);
	}
	return [...bySlug.values()]
		.sort((a, b) => b.pageviews - a.pageviews)
		.slice(0, limit)
		.map(({ slug, title }) => ({ slug, title }));
}
