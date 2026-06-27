import { RateLimiter, MINUTE } from '@convex-dev/rate-limiter';
import { ConvexError } from 'convex/values';
import { components } from './_generated/api';

const TEN_MINUTES = 10 * MINUTE;

/** Env-overridable positive integer rate; invalid/unset → fallback (mirrors maxCardsPerDay). */
function envRate(name: string, fallback: number): number {
	const raw = Number(process.env[name]);
	return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export function ensureSupplyLimit() {
	const rate = envRate('RL_ENSURE_SUPPLY_RATE', 5);
	return { kind: 'token bucket' as const, rate, period: TEN_MINUTES, capacity: rate };
}

export function forCardLimit() {
	const rate = envRate('RL_FOR_CARD_RATE', 30);
	return { kind: 'token bucket' as const, rate, period: MINUTE, capacity: rate };
}

export function interestsAddLimit() {
	const rate = envRate('RL_INTERESTS_ADD_RATE', 20);
	return { kind: 'token bucket' as const, rate, period: MINUTE, capacity: rate };
}

/**
 * Per-device rate limits (W5 / release-gates B2). Keyed off the B1 server-verified
 * session subject so they can't be bypassed by spoofing the deviceId arg.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
	ensureSupply: ensureSupplyLimit(),
	forCard: forCardLimit(),
	interestsAdd: interestsAddLimit()
});

/**
 * Test seam: convex-test cannot run components in this repo (see
 * generationPipeline.test.ts), so the convex vitest project sets
 * RATE_LIMIT_DISABLED=1 and every limit call is guarded by this. In production
 * the env is unset and limits enforce normally.
 */
export function rateLimitsDisabled(): boolean {
	return process.env.RATE_LIMIT_DISABLED === '1';
}

/** Rate-limit key for forCard: the session subject, or a shared 'anon' bucket. */
export function forCardKey(subject: string | undefined): string {
	return subject !== undefined && subject.length > 0 ? subject : 'anon';
}

/** The typed error clients detect to handle a rate-limited call silently. */
export function rateLimitedError(retryAfter?: number): ConvexError<{
	code: 'rate_limited';
	retryAfter: number | undefined;
}> {
	return new ConvexError({ code: 'rate_limited' as const, retryAfter });
}
