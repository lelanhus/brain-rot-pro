import { describe, expect, it } from 'vitest';
import { isFreeLicense, selectFreeImage, stripHtml, type RawImageInfo } from './imageLicense';

/** Build imageinfo with sensible defaults so each test states only what it varies. */
function info(over: {
	license?: string;
	licenseShortName?: string;
	nonFree?: string;
	restrictions?: string;
	artist?: string;
	licenseUrl?: string;
	attribution?: string;
	thumburl?: string | null;
	descriptionurl?: string | null;
}): RawImageInfo {
	const m: Record<string, { value: string }> = {};
	const set = (k: string, v?: string) => {
		if (v !== undefined) m[k] = { value: v };
	};
	set('License', over.license);
	set('LicenseShortName', over.licenseShortName);
	set('NonFree', over.nonFree);
	set('Restrictions', over.restrictions);
	set('Artist', over.artist);
	set('LicenseUrl', over.licenseUrl);
	set('Attribution', over.attribution);
	return {
		thumburl: over.thumburl === null ? undefined : (over.thumburl ?? 'https://up/thumb.jpg'),
		descriptionurl:
			over.descriptionurl === null
				? undefined
				: (over.descriptionurl ?? 'https://commons.wikimedia.org/wiki/File:X.jpg'),
		extmetadata: m
	};
}

describe('isFreeLicense', () => {
	it('accepts CC0, public domain, CC BY, CC BY-SA', () => {
		expect(isFreeLicense('cc0', 'CC0')).toBe(true);
		expect(isFreeLicense('pd', 'Public domain')).toBe(true);
		expect(isFreeLicense('cc-by-4.0', 'CC BY 4.0')).toBe(true);
		expect(isFreeLicense('cc-by-sa-3.0', 'CC BY-SA 3.0')).toBe(true);
	});
	it('rejects non-commercial and no-derivatives even on a cc-by code', () => {
		expect(isFreeLicense('cc-by-nc-4.0', 'CC BY-NC 4.0')).toBe(false);
		expect(isFreeLicense('cc-by-nd-4.0', 'CC BY-ND 4.0')).toBe(false);
		expect(isFreeLicense('cc-by-nc-sa-3.0', 'CC BY-NC-SA 3.0')).toBe(false);
	});
	it('fails closed on unknown / empty licenses', () => {
		expect(isFreeLicense('', '')).toBe(false);
		expect(isFreeLicense('proprietary', 'All rights reserved')).toBe(false);
		expect(isFreeLicense('fair-use', 'Fair use')).toBe(false);
	});
	it('falls back to the short name when no machine code is present', () => {
		expect(isFreeLicense('', 'Public domain')).toBe(true);
		expect(isFreeLicense('', 'CC BY-SA 4.0')).toBe(true);
	});
});

describe('selectFreeImage', () => {
	it('builds a fully-attributed image for a free license', () => {
		const img = selectFreeImage(
			info({
				license: 'cc-by-sa-4.0',
				licenseShortName: 'CC BY-SA 4.0',
				artist: '<a href="/wiki/User:Jane">Jane Doe</a>',
				licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'
			})
		);
		expect(img).not.toBeNull();
		expect(img!.author).toBe('Jane Doe');
		expect(img!.licenseShortName).toBe('CC BY-SA 4.0');
		expect(img!.licenseUrl).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
		expect(img!.attribution).toContain('Jane Doe');
		expect(img!.thumbnailUrl).toBe('https://up/thumb.jpg');
	});

	it('fails closed on non-free, restricted, or unknown licenses', () => {
		expect(
			selectFreeImage(info({ license: 'cc-by-nc-4.0', licenseShortName: 'CC BY-NC 4.0' }))
		).toBeNull();
		expect(selectFreeImage(info({ license: 'cc-by-4.0', nonFree: 'true' }))).toBeNull();
		expect(selectFreeImage(info({ license: 'cc-by-4.0', restrictions: 'trademarked' }))).toBeNull();
		expect(selectFreeImage(info({ licenseShortName: 'All rights reserved' }))).toBeNull();
		expect(selectFreeImage(null)).toBeNull();
	});

	it('fails closed when the thumbnail or Commons page is missing', () => {
		expect(selectFreeImage(info({ license: 'cc0', thumburl: null }))).toBeNull();
		expect(selectFreeImage(info({ license: 'cc0', descriptionurl: null }))).toBeNull();
	});

	it('degrades a missing author to "Unknown author" without blocking', () => {
		const img = selectFreeImage(info({ license: 'pd', licenseShortName: 'Public domain' }));
		expect(img).not.toBeNull();
		expect(img!.author).toBe('Unknown author');
	});

	it('derives a license deed URL when Commons omits LicenseUrl', () => {
		const img = selectFreeImage(
			info({ license: 'cc-by-sa-4.0', licenseShortName: 'CC BY-SA 4.0' })
		);
		expect(img!.licenseUrl).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
		const pd = selectFreeImage(info({ license: 'cc0', licenseShortName: 'CC0' }));
		expect(pd!.licenseUrl).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
	});
});

describe('stripHtml', () => {
	it('removes tags, decodes entities, and collapses whitespace', () => {
		expect(stripHtml('<a href="x">Jane  &amp;  Co</a>')).toBe('Jane & Co');
		expect(stripHtml('  plain   text ')).toBe('plain text');
	});
});
