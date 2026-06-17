/**
 * Pure affiliate-offer constants (ADR-008). Kept separate from the Convex
 * functions so they're importable on both sides and unit-testable without a
 * deployment (engineering-standards §3).
 */

export type OfferNetwork = 'bookshop' | 'amazon' | 'course' | 'direct';

/**
 * Program-required disclosure text, shown with every slot for FTC compliance.
 * Used as the default when an offer is added without an explicit disclosure.
 * Bookshop.org is the launch program (ADR-008): no sales-quota termination,
 * easy signup, on-brand for a learning product.
 */
export const DISCLOSURE: Record<OfferNetwork, string> = {
	bookshop:
		'Affiliate link — we may earn a commission. Supports local bookstores via Bookshop.org.',
	amazon: 'As an Amazon Associate we earn from qualifying purchases.',
	course: 'Affiliate link — we may earn a commission on enrollments.',
	direct: 'Sponsored.'
};

/** Click-through rate, guarded against divide-by-zero (no impressions → 0). */
export function ctr(clicks: number, impressions: number): number {
	return impressions === 0 ? 0 : clicks / impressions;
}

type OfferEventLite = { type: string; offerId?: string };

/**
 * Tally sponsored impressions/clicks per offer from a flat event list. Pure so
 * the reporting query (`affiliate.report`) stays a thin DB-read + this fold, and
 * the counting is unit-testable without a deployment (engineering-standards §3).
 */
export function tallyOfferEvents(
	events: readonly OfferEventLite[]
): Map<string, { impressions: number; clicks: number }> {
	const tally = new Map<string, { impressions: number; clicks: number }>();
	for (const e of events) {
		if (!e.offerId) continue;
		if (e.type !== 'sponsored_impression' && e.type !== 'sponsored_click') continue;
		const row = tally.get(e.offerId) ?? { impressions: 0, clicks: 0 };
		if (e.type === 'sponsored_impression') row.impressions++;
		else row.clicks++;
		tally.set(e.offerId, row);
	}
	return tally;
}
