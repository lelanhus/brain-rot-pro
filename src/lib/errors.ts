import { ConvexError } from 'convex/values';

/** A user-facing message from an unknown thrown value, falling back when it isn't an Error. */
export function errorMessage(err: unknown, fallback: string): string {
	return err instanceof Error ? err.message : fallback;
}

/** True when a thrown value is the server's `rate_limited` ConvexError. */
export function isRateLimited(err: unknown): boolean {
	return (
		err instanceof ConvexError &&
		typeof err.data === 'object' &&
		err.data !== null &&
		(err.data as { code?: unknown }).code === 'rate_limited'
	);
}
