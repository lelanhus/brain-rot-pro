import { describe, expect, it } from 'vitest';
import { tokenMatches } from './adminAuth';

describe('tokenMatches', () => {
	it('matches an identical token', () => {
		expect(tokenMatches('s3cret', 's3cret')).toBe(true);
	});
	it('rejects a wrong token, a prefix, and a longer one', () => {
		expect(tokenMatches('s3cret', 'other')).toBe(false);
		expect(tokenMatches('s3cre', 's3cret')).toBe(false);
		expect(tokenMatches('s3cretX', 's3cret')).toBe(false);
	});
	it('rejects everything when no secret is configured', () => {
		expect(tokenMatches('', '')).toBe(false);
		expect(tokenMatches('anything', '')).toBe(false);
	});
});
