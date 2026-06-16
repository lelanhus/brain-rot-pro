import { describe, expect, it } from 'vitest';
import {
	formatCodeForDisplay,
	generateCode,
	isExpired,
	isValidCodeFormat,
	normalizeCode
} from './syncLogic';

describe('generateCode', () => {
	it('produces an 8-char in-charset code with no ambiguous glyphs', () => {
		// A deterministic RNG walks the charset start; assert shape + no I/O/0/1.
		const code = generateCode(() => 0);
		expect(isValidCodeFormat(code)).toBe(true);
		expect(code).toHaveLength(8);
		expect(/[ILOU01]/.test(code)).toBe(false);
	});
});

describe('normalizeCode', () => {
	it('uppercases and strips separators/spaces to the lookup form', () => {
		expect(normalizeCode('abcd-2345')).toBe('ABCD2345');
		expect(normalizeCode('  ab cd 23 45 ')).toBe('ABCD2345');
	});
	it('drops out-of-charset characters (the ambiguous ones)', () => {
		expect(normalizeCode('ABO0I1CD')).toBe('ABCD'); // O,0,I,1 removed
	});
});

describe('isValidCodeFormat', () => {
	it('accepts a clean 8-char code and rejects wrong length or charset', () => {
		expect(isValidCodeFormat('ABCD2345')).toBe(true);
		expect(isValidCodeFormat('ABCD234')).toBe(false); // too short
		expect(isValidCodeFormat('ABCD2340')).toBe(false); // contains 0
	});
});

describe('formatCodeForDisplay', () => {
	it('groups into two quads for legibility', () => {
		expect(formatCodeForDisplay('ABCD2345')).toBe('ABCD-2345');
	});
});

describe('isExpired', () => {
	it('is true only at or after the expiry instant', () => {
		expect(isExpired(1000, 999)).toBe(false);
		expect(isExpired(1000, 1000)).toBe(true);
		expect(isExpired(1000, 1001)).toBe(true);
	});
});
