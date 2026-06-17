import { ConvexError } from 'convex/values';

/**
 * Admin authorization (ADR-008 phase B). A pre-auth, shared-secret gate for the
 * internal admin surface — sized for the current anonymous/device-id world
 * (ADR-004 defers real accounts). The secret lives only on the Convex deployment
 * (`npx convex env set ADMIN_TOKEN …`); the client sends it per call. When real
 * auth (Better Auth) lands, swap `assertAdmin` for an `ctx.auth` role check and
 * the call sites stay the same.
 */

/**
 * Constant-time-ish string compare so a wrong token can't be recovered byte by
 * byte via response timing. Pure → unit-testable without a deployment.
 */
export function tokenMatches(provided: string, expected: string): boolean {
	if (expected.length === 0) return false;
	const len = Math.max(provided.length, expected.length);
	let mismatch = provided.length ^ expected.length;
	for (let i = 0; i < len; i++) {
		mismatch |= (provided.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
	}
	return mismatch === 0;
}

/**
 * Throw unless `token` matches the deployment's `ADMIN_TOKEN`. Fails loud and
 * typed (`ConvexError`) so the client can react — distinguishing "not configured"
 * (operator error) from "unauthorized" (wrong/absent token).
 */
export function assertAdmin(token: string | undefined): void {
	const expected = process.env.ADMIN_TOKEN;
	if (!expected) {
		throw new ConvexError({
			code: 'admin_not_configured',
			message: 'ADMIN_TOKEN is not set on the Convex deployment.'
		});
	}
	if (!token || !tokenMatches(token, expected)) {
		throw new ConvexError({ code: 'unauthorized', message: 'Admin authorization required.' });
	}
}
