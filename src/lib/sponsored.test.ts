import { describe, expect, it } from 'vitest';
import { injectSponsored, pickOffer, type SponsoredOffer } from './sponsored';

const offer = (id: string, tags: string[], weight = 1): SponsoredOffer => ({
	_id: id,
	headline: `Offer ${id}`,
	blurb: 'A relevant book.',
	cta: 'View',
	url: `https://example.com/${id}`,
	network: 'bookshop',
	disclosure: 'Affiliate link.',
	conceptTags: tags,
	weight
});

const card = (id: string, tags: string[] = []) => ({ _id: id, conceptTags: tags });

describe('pickOffer', () => {
	it('returns null when nothing overlaps (no irrelevant ads)', () => {
		expect(pickOffer([offer('a', ['rome'])], ['volcano'])).toBeNull();
	});

	it('prefers higher tag overlap, then weight, then a stable id tie-break', () => {
		const offers = [
			offer('a', ['rome'], 5),
			offer('b', ['rome', 'history'], 1),
			offer('c', ['rome'], 5)
		];
		// b overlaps 2 tags → wins despite lower weight.
		expect(pickOffer(offers, ['rome', 'history'])?._id).toBe('b');
		// Among equal-overlap a & c (weight tie), 'a' < 'c' wins deterministically.
		expect(pickOffer(offers, ['rome'])?._id).toBe('a');
	});

	it('honors excludeIds so the same offer is not reused', () => {
		const offers = [offer('a', ['rome'], 5), offer('c', ['rome'], 5)];
		expect(pickOffer(offers, ['rome'], { excludeIds: new Set(['a']) })?._id).toBe('c');
	});
});

describe('injectSponsored', () => {
	const cards = Array.from({ length: 25 }, (_, i) => card(`c${i}`, ['rome']));

	it('off mode returns only cards', () => {
		const out = injectSponsored(cards, { mode: 'off' });
		expect(out).toHaveLength(25);
		expect(out.every((i) => i.kind === 'card')).toBe(true);
	});

	it('network mode inserts empty slots at cadence, capped, after firstAfter', () => {
		const out = injectSponsored(cards, { mode: 'network', cadence: 5, firstAfter: 5, maxSlots: 3 });
		const slots = out.filter((i) => i.kind === 'slot');
		expect(slots).toHaveLength(3);
		expect(slots.every((s) => s.kind === 'slot' && s.offer === null)).toBe(true);
		// First slot sits right after the 5th organic card.
		expect(out[5]).toMatchObject({ kind: 'slot' });
	});

	it('offers mode emits a relevant offer per slot and never repeats one', () => {
		const offers = [offer('a', ['rome'], 3), offer('b', ['rome'], 2)];
		const out = injectSponsored(cards, {
			mode: 'offers',
			offers,
			cadence: 5,
			firstAfter: 5,
			maxSlots: 5
		});
		const slotOffers = out.flatMap((i) => (i.kind === 'slot' && i.offer ? [i.offer._id] : []));
		// Two distinct offers available → two slots, no repeats, then it stops.
		expect(slotOffers).toEqual(['a', 'b']);
	});

	it('does not place a slot immediately before a woven-in related card', () => {
		// A slot is due after c4 (firstAfter 5, 0-indexed position 4). Mark the next
		// card as related → the slot must be skipped at that boundary.
		const out = injectSponsored(cards, {
			mode: 'network',
			cadence: 5,
			firstAfter: 5,
			maxSlots: 3,
			skipBefore: new Set(['c5'])
		});
		// The item right after c4 should be the c5 card, not a slot.
		const c4Index = out.findIndex((i) => i.kind === 'card' && i.card._id === 'c4');
		expect(out[c4Index + 1]).toMatchObject({ kind: 'card', card: { _id: 'c5' } });
	});
});
