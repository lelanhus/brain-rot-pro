import { describe, expect, it } from 'vitest';
import { parsePageviewLine } from './dumpParse';

describe('parsePageviewLine', () => {
	it('parses an en main-namespace article line', () => {
		expect(parsePageviewLine('en Cleopatra 540 0')).toEqual({ title: 'Cleopatra', views: 540 });
		expect(parsePageviewLine('en Marie_Curie 1200 0')).toEqual({
			title: 'Marie_Curie',
			views: 1200
		});
	});
	it('rejects other domains, junk titles, and malformed lines', () => {
		expect(parsePageviewLine('de Berlin 900 0')).toBeNull(); // not en
		expect(parsePageviewLine('en.m Cleopatra 5 0')).toBeNull(); // mobile domain
		expect(parsePageviewLine('en Main_Page 99999 0')).toBeNull(); // structural junk
		expect(parsePageviewLine('en .xyz 50 0')).toBeNull(); // quality junk
		expect(parsePageviewLine('en Special:Search 50 0')).toBeNull();
		expect(parsePageviewLine('garbage')).toBeNull();
		expect(parsePageviewLine('en Foo notanumber 0')).toBeNull();
	});
});
