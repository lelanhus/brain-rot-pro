import { describe, expect, it } from 'vitest';
import { isRealArticleTitle, toSlug, mergePageviews } from './topicsLogic';

describe('isRealArticleTitle', () => {
	it('accepts real articles (underscored or spaced)', () => {
		expect(isRealArticleTitle('Marie_Curie')).toBe(true);
		expect(isRealArticleTitle('Black hole')).toBe(true);
	});

	it('rejects namespaces, chrome, lists, disambiguation, bare numbers, empty', () => {
		expect(isRealArticleTitle('Main_Page')).toBe(false);
		expect(isRealArticleTitle('Special:Search')).toBe(false);
		expect(isRealArticleTitle('Wikipedia:About')).toBe(false);
		expect(isRealArticleTitle('Category:Physics')).toBe(false);
		expect(isRealArticleTitle('List_of_largest_cities')).toBe(false);
		expect(isRealArticleTitle('List of\tlargest cities')).toBe(false);
		expect(isRealArticleTitle('Mercury_(disambiguation)')).toBe(false);
		expect(isRealArticleTitle('2008')).toBe(false);
		expect(isRealArticleTitle('   ')).toBe(false);
	});
});

describe('toSlug', () => {
	it('normalizes spacing, underscores, and case to one key', () => {
		expect(toSlug('Marie Curie')).toBe('marie_curie');
		expect(toSlug('Marie_Curie')).toBe('marie_curie');
		expect(toSlug('  Black   Hole  ')).toBe('black_hole');
	});
});

describe('mergePageviews', () => {
	it('sums cumulative views across days', () => {
		expect(mergePageviews(0, 500)).toBe(500);
		expect(mergePageviews(500, 300)).toBe(800);
	});
});
