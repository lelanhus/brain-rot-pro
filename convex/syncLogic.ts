/**
 * Anonymous account sync (ADR-004 — the "anonymous" half, delivered without an
 * external OAuth provider). The per-device id IS the anonymous account key; a
 * short-lived, single-use code lets another device adopt the same account, so
 * saves / streak / personalization follow you across devices. Pure helpers here
 * (code shape, expiry); the network/DB lives in `sync.ts`.
 *
 * Better Auth + Google/Apple remains the future upgrade for frictionless,
 * codeless multi-device — this is the seam it would slot into.
 */

/** How long a sync code is valid. Short, because it grants account access. */
export const CODE_TTL_MS = 15 * 60_000;

// Crockford-ish base32 minus visually ambiguous glyphs (no I, L, O, U, 0, 1).
const CHARSET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 8;

/** Generate a code from an injectable RNG (so it's unit-testable). */
export function generateCode(rand: () => number = Math.random): string {
	let out = '';
	for (let i = 0; i < CODE_LENGTH; i++) {
		out += CHARSET[Math.floor(rand() * CHARSET.length)];
	}
	return out;
}

/** Canonical stored/lookup form: uppercase, only charset chars (drops spaces/dashes). */
export function normalizeCode(input: string): string {
	return input
		.toUpperCase()
		.split('')
		.filter((ch) => CHARSET.includes(ch))
		.join('');
}

/** Is this a structurally valid code (right length, in-charset)? */
export function isValidCodeFormat(code: string): boolean {
	return code.length === CODE_LENGTH && [...code].every((ch) => CHARSET.includes(ch));
}

/** Display form with a separator for legibility (e.g. ABCD-2345). */
export function formatCodeForDisplay(code: string): string {
	return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function isExpired(expiresAt: number, now: number): boolean {
	return now >= expiresAt;
}
