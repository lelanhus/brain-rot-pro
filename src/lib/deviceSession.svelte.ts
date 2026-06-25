import { browser } from '$app/environment';
import { authClient } from './auth-client';

/**
 * Session-derived device identity (B1 / docs/release-gates.md).
 *
 * The device principal IS the Better Auth session subject — the value the server
 * verifies in `deviceIdentity.requireDevice`. Anonymous-first: on the client we
 * establish an anonymous session if none exists, so every visitor gets a stable,
 * server-trusted id without a sign-in wall. `deviceId` is '' until the session
 * resolves (SSR + the first client round-trip); the feed and every device-scoped
 * query already tolerate that interim via the anonymous/global path or `'skip'`.
 *
 * Cross-device sync is sign-in-based (same Google account → the server's
 * `onLinkAccount` merges the anon device's data), replacing the old sync-code
 * flow that swapped a client-controlled id (impossible under session identity).
 */

let id = $state('');

export const deviceSession = {
	get deviceId(): string {
		return id;
	}
};

let started = false;

/**
 * Begin tracking the session and backfilling `deviceId` from its subject.
 * Establishes an anonymous session when the visitor has none. Call once, from the
 * root layout, inside an effect root. Browser-only (no session during SSR).
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
			id = uid;
			signingIn = false;
			return;
		}
		// No session yet → establish an anonymous one (once).
		if (!signingIn) {
			signingIn = true;
			void authClient.signIn.anonymous().catch(() => {
				// Surface nothing to the user; the feed stays on its anonymous path
				// and the next session tick retries.
				signingIn = false;
			});
		}
	});
}
