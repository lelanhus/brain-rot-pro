import { describe, expect, it } from 'vitest';
import { capText, looksLikeArticleTitle, stripCategoryPrefix, toParagraphs } from './ingestUtils';

describe('looksLikeArticleTitle', () => {
	it('accepts real article titles', () => {
		expect(looksLikeArticleTitle('Roman concrete')).toBe(true);
		expect(looksLikeArticleTitle('Octopus')).toBe(true);
	});
	it('rejects non-article namespaces and noise', () => {
		expect(looksLikeArticleTitle('Special:Search')).toBe(false);
		expect(looksLikeArticleTitle('Wikipedia:About')).toBe(false);
		expect(looksLikeArticleTitle('Main Page')).toBe(false);
		expect(looksLikeArticleTitle('')).toBe(false);
	});
});

describe('toParagraphs', () => {
	it('splits, trims, drops short lines and headers, and caps count', () => {
		const text = [
			'Intro paragraph that is definitely long enough to keep around here.',
			'',
			'short',
			'History=',
			'A second substantial paragraph with more than forty characters of text.'
		].join('\n');
		const paras = toParagraphs(text, { max: 5 });
		expect(paras).toHaveLength(2);
		expect(paras[0]).toMatch(/^Intro/);
		expect(paras.every((p) => p.length >= 40)).toBe(true);
	});

	it('respects the max count', () => {
		const long = Array(30)
			.fill('A sufficiently long paragraph of more than forty characters here.')
			.join('\n');
		expect(toParagraphs(long, { max: 8 })).toHaveLength(8);
	});
});

describe('stripCategoryPrefix / capText', () => {
	it('strips the Category: prefix', () => {
		expect(stripCategoryPrefix('Category:Ancient Rome')).toBe('Ancient Rome');
		expect(stripCategoryPrefix('Ancient Rome')).toBe('Ancient Rome');
	});
	it('caps long text', () => {
		expect(capText('abcdef', 3)).toBe('abc');
		expect(capText('abc', 10)).toBe('abc');
	});
});
