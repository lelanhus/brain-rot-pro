import { describe, expect, it } from 'vitest';
import { ctr, tallyOfferEvents } from './affiliateLogic';

describe('ctr', () => {
	it('is zero with no impressions (no divide-by-zero)', () => {
		expect(ctr(0, 0)).toBe(0);
		expect(ctr(5, 0)).toBe(0);
	});
	it('is clicks / impressions', () => {
		expect(ctr(2, 8)).toBe(0.25);
	});
});

describe('tallyOfferEvents', () => {
	it('counts impressions and clicks per offer, ignoring other events', () => {
		const tally = tallyOfferEvents([
			{ type: 'sponsored_impression', offerId: 'a' },
			{ type: 'sponsored_impression', offerId: 'a' },
			{ type: 'sponsored_click', offerId: 'a' },
			{ type: 'sponsored_impression', offerId: 'b' },
			{ type: 'card_complete', offerId: 'a' }, // not a sponsored event → ignored
			{ type: 'sponsored_click' } // no offerId → ignored
		]);
		expect(tally.get('a')).toEqual({ impressions: 2, clicks: 1 });
		expect(tally.get('b')).toEqual({ impressions: 1, clicks: 0 });
		expect(tally.size).toBe(2);
	});
});
