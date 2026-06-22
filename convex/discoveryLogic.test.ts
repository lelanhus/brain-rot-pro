import { describe, expect, it } from 'vitest';
import { pickDiscoveries } from './discoveryLogic';

describe('pickDiscoveries', () => {
	const c = (slug: string, pageviews: number) => ({ slug, title: slug, pageviews });
	it('drops followed, dedupes by slug, sorts by pageviews desc, caps at limit', () => {
		const cands = [c('a', 10), c('b', 50), c('b', 50), c('c', 30), c('d', 99)];
		const picks = pickDiscoveries(cands, new Set(['d']), 2);
		expect(picks.map((p) => p.slug)).toEqual(['b', 'c']); // d followed; b>c by views; cap 2
	});
	it('returns [] when all followed', () => {
		expect(pickDiscoveries([c('a', 5)], new Set(['a']), 3)).toEqual([]);
	});
});
