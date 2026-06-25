import { ConvexError } from 'convex/values';
import type { Auth } from 'convex/server';

/**
 * Server-derived device identity (B1 / docs/release-gates.md).
 *
 * Every visitor — anonymous or signed-in — carries a Better Auth session whose
 * `subject` IS their durable device principal; the client sets its `deviceId` to
 * that subject. A device-scoped PUBLIC function calls `requireDevice` to verify
 * the caller actually owns the `deviceId` it claims, instead of trusting the
 * arg. This closes the forgery hole where any client could pass another user's
 * `deviceId` to read, mutate, or erase their data.
 *
 * Internal functions (merge / purge / sync internals) operate on arbitrary
 * deviceIds and deliberately do NOT call this — they aren't client-reachable, so
 * the public caller that scheduled them has already been verified.
 *
 * Throws a typed `ConvexError` so the client can react: `unauthenticated` when
 * there is no session (the client should establish/await one), `forbidden` when
 * the claimed id isn't the caller's own. Returns the verified subject.
 */
export async function requireDevice(ctx: { auth: Auth }, claimed: string): Promise<string> {
	const identity = await ctx.auth.getUserIdentity();
	if (identity === null) {
		throw new ConvexError({
			code: 'unauthenticated',
			message: 'A session is required. The app establishes one automatically.'
		});
	}
	if (claimed.length === 0 || identity.subject !== claimed) {
		throw new ConvexError({
			code: 'forbidden',
			message: 'deviceId does not match the authenticated session.'
		});
	}
	return identity.subject;
}

/**
 * Soft variant for read paths that must stay SSR-safe (notably `feed.unseen`,
 * which is server-rendered for the first card before any session may exist, per
 * the "no loading flash" gate). Returns the claimed deviceId only when it is the
 * caller's own session subject; otherwise returns '' so the caller falls back to
 * the anonymous/global path. A forged deviceId thus leaks nothing — it just gets
 * the un-personalized feed — without throwing and breaking SSR.
 */
export async function ownedDeviceOrEmpty(ctx: { auth: Auth }, claimed: string): Promise<string> {
	if (claimed.length === 0) return '';
	const identity = await ctx.auth.getUserIdentity();
	return identity !== null && identity.subject === claimed ? claimed : '';
}
