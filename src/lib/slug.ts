/** Topic slug — MUST match convex/topicsLogic.ts toSlug (kept in sync intentionally). */
export function toSlug(title: string): string {
	return title
		.trim()
		.replace(/\s+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '')
		.toLowerCase();
}

/** Slug/DB-title → human display ("roman_concrete" → "roman concrete"). */
export function slugToDisplay(s: string): string {
	return s.replace(/_/g, ' ');
}
