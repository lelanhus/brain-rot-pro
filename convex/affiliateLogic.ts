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
