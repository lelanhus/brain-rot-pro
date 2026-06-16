import { describe, expect, it } from 'vitest';
import { buildEmbeddingText, cosineSimilarity, relatedByConcepts } from './embedLogic';

describe('buildEmbeddingText', () => {
	it('joins meaningful fields and drops empty ones', () => {
		const text = buildEmbeddingText({
			hook: 'Octopuses have three hearts.',
			body: 'Two pump blood to the gills, one to the body.',
			conceptTags: ['biology', 'cephalopods']
		});
		expect(text).toContain('three hearts');
		expect(text).toContain('biology, cephalopods');
		expect(text.split('\n')).toHaveLength(3); // no empty whyItMatters line
	});
});

describe('cosineSimilarity', () => {
	it('is 1 for identical, 0 for orthogonal, negative for opposite', () => {
		expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
		expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
		expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
	});
	it('returns 0 for a zero vector instead of NaN', () => {
		expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
	});
	it('throws on a length mismatch rather than producing garbage', () => {
		expect(() => cosineSimilarity([1, 2], [1])).toThrow(/length mismatch/);
	});
});

describe('relatedByConcepts', () => {
	const target = { _id: 't', conceptTags: ['rome', 'history', 'engineering'] };
	const candidates = [
		{ _id: 'a', conceptTags: ['rome', 'history'] }, // overlap 2
		{ _id: 'b', conceptTags: ['rome'] }, // overlap 1
		{ _id: 'c', conceptTags: ['biology'] }, // overlap 0 → excluded
		{ _id: 't', conceptTags: ['rome'] } // self → excluded
	];

	it('ranks by shared-tag count, excluding self and zero-overlap', () => {
		const result = relatedByConcepts(target, candidates, 5);
		expect(result.map((c) => c._id)).toEqual(['a', 'b']);
	});

	it('respects the limit', () => {
		expect(relatedByConcepts(target, candidates, 1).map((c) => c._id)).toEqual(['a']);
	});
});
