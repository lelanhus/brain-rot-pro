import { browser } from '$app/environment';
import { authClient } from './auth-client';

/**
 * Session-derived device identity (B1 / docs/release-gates.md).
 *
 * The device principal IS the Better Auth session subject — the value the server
 * verifies in `deviceIdentity.requireDevice`. Anonymous-first: on the client we
 * establish an anonymous session if none exists, so every visitor gets a stable,
 * server-trusted id without a sign-in wall.
 *
 * `deviceId` stays '' until BOTH (a) the session subject is known AND (b) the
 * Convex client has attached its auth token (`authReady`, fed from
 * `useAuth().isAuthenticated` in the root layout). Exposing it any earlier races
 * the token attachment: queries self-heal on the auth change, but one-shot
 * mutations (recordActivity / recompute / ensureSupply) would fire once and fail
 * `unauthenticated`. Every consumer keys on this single value; the feed and the
 * device-scoped `'skip'` guards already tolerate the empty interim.
 *
 * Cross-device sync is sign-in-based (same Google account → the server's
 * `onLinkAccount` merges the anon device's data), replacing the old sync-code
 * flow that swapped a client-controlled id (impossible under session identity).
 */

let subject = $state('');
let authReady = $state(false);

export const deviceSession = {
	get deviceId(): string {
		return authReady ? subject : '';
	}
};

/** Fed from the layout's `useAuth().isAuthenticated` — gates `deviceId` on the
 *  Convex token actually being attached, not just the session existing. */
export function setAuthReady(ready: boolean): void {
	authReady = ready;
}

let started = false;

/**
 * Track the Better Auth session for its subject, and establish an anonymous
 * session when the visitor has none. Call once, from the root layout. Browser-
 * only (no session during SSR).
 */
export function startDeviceSession(): void {
	if (!browser || started) return;
	started = true;

	const session = authClient.useSession();
	let signingIn = false;

	session.subscribe((s) => {
		if (s.isPending) return;
		const uid = s.data?.user?.id ?? '';
		if (uid.length > 0) {
			subject = uid;
			signingIn = false;
			return;
		}
		// No session yet → establish an anonymous one (once).
		if (!signingIn) {
			signingIn = true;
			void authClient.signIn.anonymous().catch(() => {
				// Surface nothing; the feed stays on its anonymous path and the next
				// session tick retries.
				signingIn = false;
			});
		}
	});
}
