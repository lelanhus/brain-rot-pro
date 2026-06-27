import { describe, expect, it } from 'vitest';
import { ConvexError } from 'convex/values';
import { isRateLimited } from './errors';

describe('isRateLimited', () => {
	it('is true for a ConvexError with code rate_limited', () => {
		expect(isRateLimited(new ConvexError({ code: 'rate_limited', retryAfter: 1 }))).toBe(true);
	});
	it('is false for other ConvexErrors and plain errors', () => {
		expect(isRateLimited(new ConvexError({ code: 'unauthenticated' }))).toBe(false);
		expect(isRateLimited(new Error('nope'))).toBe(false);
		expect(isRateLimited(undefined)).toBe(false);
	});
});
