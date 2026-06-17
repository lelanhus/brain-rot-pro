/**
 * Sponsored-slot logic (ADR-008 — monetization). Pure and deterministic so it's
 * unit-testable without a deployment and never introduces feed jitter (mirrors
 * the no-in-query-RNG discipline of ADR-007).
 *
 * Two provider modes share one slot:
 *  - `offers`  — contextual affiliate "Go deeper" cards from `affiliateOffers`,
 *                matched to the surrounding card's concept tags. Works today,
 *                no ad-network approval required.
 *  - `network` — an env-configured ad-network unit fills the slot (the slot
 *                carries no offer; the renderer drops in the network's tag).
 *  - `off`     — no slots (default until a provider is configured).
 */

/** The offer shape the feed needs — structurally satisfied by `api.affiliate.active`. */
export type SponsoredOffer = {
	_id: string;
	headline: string;
	blurb: string;
	imageUrl?: string;
	cta: string;
	url: string;
	network: 'bookshop' | 'amazon' | 'course' | 'direct';
	disclosure: string;
	conceptTags: string[];
	weight: number;
};

export type SlotMode = 'offers' | 'network' | 'off';

export type FeedItem<T> =
	| { kind: 'card'; card: T }
	| { kind: 'slot'; id: string; offer: SponsoredOffer | null };

/** Slot pacing. Conservative defaults; tune against retention (plan phase B). */
export const SLOT_CADENCE = 10; // one slot per N organic cards
export const FIRST_SLOT_AFTER = 5; // no slot before the user is engaged
export const MAX_SLOTS_PER_SESSION = 3; // frequency cap per render

/**
 * Pick the best active offer for a set of nearby concept tags. Score is tag
 * overlap first, then `weight`, with a deterministic `_id` tie-break. Returns
 * `null` when nothing clears `minOverlap` — we show NO slot rather than an
 * irrelevant one (the quality bar that keeps slots from feeling like spam).
 */
export function pickOffer(
	offers: readonly SponsoredOffer[],
	nearbyTags: readonly string[],
	opts: { minOverlap?: number; excludeIds?: ReadonlySet<string> } = {}
): SponsoredOffer | null {
	const minOverlap = opts.minOverlap ?? 1;
	const exclude = opts.excludeIds;
	const tags = new Set(nearbyTags);
	let best: SponsoredOffer | null = null;
	let bestOverlap = 0;
	for (const offer of offers) {
		if (exclude?.has(offer._id)) continue;
		let overlap = 0;
		for (const t of offer.conceptTags) if (tags.has(t)) overlap++;
		if (overlap < minOverlap) continue;
		if (
			best === null ||
			overlap > bestOverlap ||
			(overlap === bestOverlap && offer.weight > best.weight) ||
			(overlap === bestOverlap && offer.weight === best.weight && offer._id < best._id)
		) {
			best = offer;
			bestOverlap = overlap;
		}
	}
	return best;
}

/**
 * Insert sponsored slots into an already-woven card list at a fixed cadence,
 * capped per render. Never places a slot immediately before a `skipBefore`
 * card (the related cards woven in by "more like this") so a rabbit-hole dive
 * is never interrupted mid-thread. In `offers` mode a slot is emitted only when
 * a contextually-relevant, not-yet-used offer exists; in `network` mode the
 * slot is emitted empty for the ad network to fill.
 */
export function injectSponsored<T extends { _id: string; conceptTags: string[] }>(
	cards: readonly T[],
	opts: {
		mode: SlotMode;
		offers?: readonly SponsoredOffer[];
		cadence?: number;
		firstAfter?: number;
		maxSlots?: number;
		skipBefore?: ReadonlySet<string>;
	}
): FeedItem<T>[] {
	const out: FeedItem<T>[] = [];
	if (opts.mode === 'off') {
		for (const card of cards) out.push({ kind: 'card', card });
		return out;
	}

	const cadence = opts.cadence ?? SLOT_CADENCE;
	const firstAfter = opts.firstAfter ?? FIRST_SLOT_AFTER;
	const maxSlots = opts.maxSlots ?? MAX_SLOTS_PER_SESSION;
	const offers = opts.offers ?? [];
	const used = new Set<string>();
	let slots = 0;
	let organic = 0;

	for (let i = 0; i < cards.length; i++) {
		const card = cards[i];
		out.push({ kind: 'card', card });
		organic++;

		const due = organic >= firstAfter && (organic - firstAfter) % cadence === 0;
		if (!due || slots >= maxSlots) continue;

		const next = cards[i + 1];
		if (next && opts.skipBefore?.has(next._id)) continue; // don't split a dive

		if (opts.mode === 'network') {
			out.push({ kind: 'slot', id: `slot:${slots}`, offer: null });
			slots++;
			continue;
		}

		// offers mode: only emit when a relevant, unused offer exists.
		const offer = pickOffer(offers, card.conceptTags, { excludeIds: used });
		if (!offer) continue;
		used.add(offer._id);
		out.push({ kind: 'slot', id: `slot:${offer._id}`, offer });
		slots++;
	}

	return out;
}
