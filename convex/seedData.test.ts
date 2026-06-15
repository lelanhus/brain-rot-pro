import { describe, expect, it } from 'vitest';
import { seedCards } from './seedData';

describe('seed cards', () => {
	it('has a healthy starter set', () => {
		expect(seedCards.length).toBeGreaterThanOrEqual(15);
	});

	it('every card has content and source provenance', () => {
		for (const c of seedCards) {
			expect(c.hook.trim().length).toBeGreaterThan(0);
			expect(c.body.trim().length).toBeGreaterThan(0);
			expect(c.conceptTags.length).toBeGreaterThan(0);
			expect(c.source.articleUrl).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//);
			expect(c.source.sourceSpan.trim().length).toBeGreaterThan(0);
		}
	});

	it('keeps bodies feed-sized (roughly 30-140 words)', () => {
		for (const c of seedCards) {
			const words = c.body.trim().split(/\s+/).length;
			expect(words).toBeGreaterThanOrEqual(30);
			expect(words).toBeLessThanOrEqual(140);
		}
	});
});
