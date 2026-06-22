import { describe, expect, it } from 'vitest';
import { isRealArticleTitle, toSlug, mergePageviews, isQualityTopic } from './topicsLogic';

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

describe('isQualityTopic', () => {
	it('rejects TLDs, Deaths-in, and YYYY-in ranking pages', () => {
		expect(isQualityTopic('.xyz')).toBe(false);
		expect(isQualityTopic('.xxx')).toBe(false);
		expect(isQualityTopic('Deaths in 2026')).toBe(false);
		expect(isQualityTopic('Deaths_in_2026')).toBe(false);
		expect(isQualityTopic('2008_in_music')).toBe(false);
		expect(isQualityTopic('2026 in film')).toBe(false);
	});
	it('accepts real subjects incl. year-prefix events', () => {
		expect(isQualityTopic('Cleopatra')).toBe(true);
		expect(isQualityTopic('Cristiano Ronaldo')).toBe(true);
		expect(isQualityTopic('Cape Verde')).toBe(true);
		expect(isQualityTopic('2026 FIFA World Cup')).toBe(true);
		expect(isQualityTopic('ChatGPT')).toBe(true);
		expect(isQualityTopic('Death in Venice')).toBe(true);
	});
});
