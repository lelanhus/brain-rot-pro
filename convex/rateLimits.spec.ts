import { describe, expect, it } from 'vitest';
import { ConvexError } from 'convex/values';
import {
	ensureSupplyLimit,
	forCardLimit,
	interestsAddLimit,
	forCardKey,
	rateLimitedError,
	rateLimitsDisabled
} from './rateLimits';

describe('rate-limit config', () => {
	it('ensureSupplyLimit defaults to rate 5 / 10 min token bucket', () => {
		const prev = process.env.RL_ENSURE_SUPPLY_RATE;
		delete process.env.RL_ENSURE_SUPPLY_RATE;
		const cfg = ensureSupplyLimit();
		expect(cfg).toEqual({ kind: 'token bucket', rate: 5, period: 10 * 60_000, capacity: 5 });
		if (prev === undefined) delete process.env.RL_ENSURE_SUPPLY_RATE;
		else process.env.RL_ENSURE_SUPPLY_RATE = prev;
	});

	it('forCardLimit honors a valid env override', () => {
		const prev = process.env.RL_FOR_CARD_RATE;
		process.env.RL_FOR_CARD_RATE = '50';
		const cfg = forCardLimit();
		expect(cfg.rate).toBe(50);
		expect(cfg.capacity).toBe(50);
		if (prev === undefined) delete process.env.RL_FOR_CARD_RATE;
		else process.env.RL_FOR_CARD_RATE = prev;
	});

	it('interestsAddLimit falls back to default on invalid env', () => {
		const prev = process.env.RL_INTERESTS_ADD_RATE;
		process.env.RL_INTERESTS_ADD_RATE = 'not-a-number';
		expect(interestsAddLimit().rate).toBe(20);
		if (prev === undefined) delete process.env.RL_INTERESTS_ADD_RATE;
		else process.env.RL_INTERESTS_ADD_RATE = prev;
	});
});

describe('rate-limit helpers', () => {
	it('forCardKey returns the subject, or "anon" when absent', () => {
		expect(forCardKey('sub_123')).toBe('sub_123');
		expect(forCardKey(undefined)).toBe('anon');
		expect(forCardKey('')).toBe('anon');
	});

	it('rateLimitedError is a ConvexError carrying code rate_limited', () => {
		const err = rateLimitedError(1234);
		expect(err).toBeInstanceOf(ConvexError);
		expect(err.data).toEqual({ code: 'rate_limited', retryAfter: 1234 });
	});

	it('rateLimitsDisabled reflects the RATE_LIMIT_DISABLED env', () => {
		const prev = process.env.RATE_LIMIT_DISABLED;
		process.env.RATE_LIMIT_DISABLED = '1';
		expect(rateLimitsDisabled()).toBe(true);
		process.env.RATE_LIMIT_DISABLED = '0';
		expect(rateLimitsDisabled()).toBe(false);
		if (prev === undefined) delete process.env.RATE_LIMIT_DISABLED;
		else process.env.RATE_LIMIT_DISABLED = prev;
	});
});
