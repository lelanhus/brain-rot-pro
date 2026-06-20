import { describe, expect, it } from 'vitest';
import { imageCandidates, isContentImage } from './imageCandidates';

describe('isContentImage', () => {
	it('accepts ordinary photos', () => {
		expect(isContentImage('Marie Curie c. 1920s.jpg')).toBe(true);
		expect(isContentImage('File:Saturn during Equinox.jpg')).toBe(true);
	});

	it('rejects wiki chrome and iconography', () => {
		expect(isContentImage('Commons-logo.svg')).toBe(false);
		expect(isContentImage('Flag of France.svg')).toBe(false);
		expect(isContentImage('Coat of arms of Spain.png')).toBe(false);
		expect(isContentImage('Edit-icon.png')).toBe(false);
		expect(isContentImage('Location map France.png')).toBe(false);
		expect(isContentImage('Question book-new.svg')).toBe(false);
	});

	it('rejects all SVGs (logos/diagrams are not card photos)', () => {
		expect(isContentImage('Some Diagram.svg')).toBe(false);
	});

	it('rejects empty / namespace-only names', () => {
		expect(isContentImage('')).toBe(false);
		expect(isContentImage('File:')).toBe(false);
	});
});

describe('imageCandidates', () => {
	it('orders lead → wikidata → page images', () => {
		const out = imageCandidates({
			leadImage: 'Lead.jpg',
			wikidataImage: 'P18 Image.jpg',
			pageImages: ['File:Body one.jpg', 'File:Body two.jpg']
		});
		expect(out).toEqual(['Lead.jpg', 'P18 Image.jpg', 'Body one.jpg', 'Body two.jpg']);
	});

	it('strips the File:/Image: prefix from page-image titles', () => {
		expect(imageCandidates({ pageImages: ['File:Foo.jpg', 'Image:Bar.png'] })).toEqual([
			'Foo.jpg',
			'Bar.png'
		]);
	});

	it('de-dupes across sources (spaces/underscores equivalent)', () => {
		const out = imageCandidates({
			leadImage: 'Marie_Curie.jpg',
			wikidataImage: 'Marie Curie.jpg',
			pageImages: ['File:Marie curie.jpg']
		});
		expect(out).toEqual(['Marie_Curie.jpg']);
	});

	it('filters out non-content files', () => {
		expect(
			imageCandidates({ leadImage: 'Commons-logo.svg', pageImages: ['File:Real photo.jpg'] })
		).toEqual(['Real photo.jpg']);
	});

	it('caps the number of candidates', () => {
		const pageImages = Array.from({ length: 20 }, (_, i) => `File:Img ${i}.jpg`);
		expect(imageCandidates({ leadImage: 'Lead.jpg', pageImages }, 3)).toHaveLength(3);
	});

	it('handles the empty case', () => {
		expect(imageCandidates({})).toEqual([]);
	});
});
