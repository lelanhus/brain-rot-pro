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
 * `deviceId` is '' until the session subject resolves (SSR + the first client
 * round-trip). Convex queries self-heal when the auth token attaches a beat
 * later (convex-svelte re-runs them on the auth-state change); the one auto-fired
 * mutation that can't (stats.recordActivity) retries on the transient
 * `unauthenticated` (see +page.svelte). Gating `deviceId` itself on
 * `isAuthenticated` was tried and reverted — that signal lags the actual token
 * (~seconds) and needlessly delayed every device-scoped feature.
 *
 * Cross-device sync is sign-in-based (same Google account → the server's
 * `onLinkAccount` merges the anon device's data), replacing the old sync-code
 * flow that swapped a client-controlled id (impossible under session identity).
 */

let subject = $state('');

export const deviceSession = {
	get deviceId(): string {
		return subject;
	}
};

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
