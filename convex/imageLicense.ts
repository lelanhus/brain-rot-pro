/**
 * Fail-closed Commons image licensing (ADR-005). Pure logic, no network — kept
 * out of the ingest action so it can be unit-tested without a deployment.
 *
 * The rule: a card MAY carry an image ONLY when we can prove it is freely
 * licensed (CC0 / public domain / CC BY / CC BY-SA) AND we have the attribution
 * fields a reuse demands. Anything we can't positively clear — unknown license,
 * non-commercial / no-derivatives terms, missing thumbnail, flagged non-free —
 * yields `null` and the card simply ships without an image. We never guess.
 */

/** The validated image shape stored on articles/cards (mirrors schema `image`). */
export type CardImage = {
	thumbnailUrl: string;
	commonsUrl: string;
	author: string;
	licenseShortName: string;
	licenseUrl: string;
	attribution: string;
};

/** A single extmetadata field as returned by the Action API's imageinfo. */
type MetaField = { value?: string | number | boolean } | undefined;

/** The subset of imageinfo we consume (Action API `iiprop=url|extmetadata`). */
export type RawImageInfo = {
	thumburl?: string;
	url?: string;
	descriptionurl?: string;
	descriptionshorturl?: string;
	extmetadata?: Record<string, MetaField>;
};

function metaString(field: MetaField): string {
	const value = field?.value;
	return value === undefined || value === null ? '' : String(value);
}

/** Strip the HTML Commons wraps Artist/Attribution in, decode common entities, collapse space. */
export function stripHtml(html: string): string {
	return html
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&#0?39;|&apos;/gi, "'")
		.replace(/&quot;/gi, '"')
		.replace(/\s+/g, ' ')
		.trim();
}

// Non-commercial / no-derivatives are NOT free — they can ride along on a
// `cc-by-*` machine code, so they must be excluded explicitly and first.
const NONFREE_TERM = /(^|-)(nc|nd)(-|$)/;

/**
 * Fail-closed free-license decision over the machine code (preferred) with the
 * human short name as a fallback signal. Returns false for anything unrecognized.
 */
export function isFreeLicense(licenseCode: string, licenseShortName: string): boolean {
	const code = licenseCode.trim().toLowerCase();
	const name = licenseShortName.trim().toLowerCase();

	if (NONFREE_TERM.test(code) || /\bnon-?commercial\b|\bno derivatives\b/.test(name)) return false;

	if (code) {
		if (code.startsWith('cc0')) return true;
		if (code.startsWith('cc-by')) return true; // cc-by, cc-by-sa (nc/nd already excluded)
		if (code.startsWith('cc-sa')) return true;
		if (code.startsWith('cc-pd') || code.startsWith('pd')) return true;
	}

	// Fall back to the short name only for unambiguous public-domain / CC0 phrasing.
	if (/\bpublic domain\b/.test(name) || name === 'cc0' || name.startsWith('cc0 ')) return true;
	if (/^cc[ -]by(?:[ -]sa)?(?:[ -][0-9.]+)?$/.test(name)) return true;

	return false;
}

/** Best-effort, license-specific deed URL when Commons omits LicenseUrl (common for PD). */
function deedUrlFor(code: string): string | null {
	const c = code.trim().toLowerCase();
	if (c.startsWith('cc0')) return 'https://creativecommons.org/publicdomain/zero/1.0/';
	if (c.startsWith('pd') || c.startsWith('cc-pd'))
		return 'https://en.wikipedia.org/wiki/Public_domain';
	const m = c.match(/^cc-(by(?:-sa)?)-([0-9.]+)$/);
	if (m) return `https://creativecommons.org/licenses/${m[1]}/${m[2]}/`;
	return null;
}

/**
 * Validate raw imageinfo and build a `CardImage`, or return `null` (fail-closed).
 * Requires: a thumbnail URL, a description (Commons) page, a recognized free
 * license, and a non-empty short name. Missing author degrades to "Unknown
 * author" (legal for PD/CC where the uploader gave none) but never blocks.
 */
export function selectFreeImage(info: RawImageInfo | null | undefined): CardImage | null {
	if (!info) return null;

	const meta = info.extmetadata ?? {};
	if (metaString(meta.NonFree).toLowerCase() === 'true') return null;
	if (metaString(meta.Restrictions).trim()) return null; // e.g. trademarked / personality rights

	const licenseShortName = metaString(meta.LicenseShortName).trim();
	const licenseCode = metaString(meta.License).trim();
	if (!licenseShortName && !licenseCode) return null;
	if (!isFreeLicense(licenseCode, licenseShortName)) return null;

	const thumbnailUrl = (info.thumburl ?? info.url ?? '').trim();
	const commonsUrl = (info.descriptionurl ?? info.descriptionshorturl ?? '').trim();
	if (!thumbnailUrl || !commonsUrl) return null;

	const licenseUrl = metaString(meta.LicenseUrl).trim() || deedUrlFor(licenseCode) || commonsUrl;

	const author = stripHtml(metaString(meta.Artist)) || 'Unknown author';
	const shortName = licenseShortName || licenseCode.toUpperCase();
	const attribution =
		stripHtml(metaString(meta.Attribution)) || `${author}, ${shortName}, via Wikimedia Commons`;

	return { thumbnailUrl, commonsUrl, author, licenseShortName: shortName, licenseUrl, attribution };
}
