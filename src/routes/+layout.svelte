<script lang="ts">
	import '../app.css';
	import { setupConvex, useAuth, getConvexClient } from '@mmailaender/convex-svelte';
	import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { env } from '$env/dynamic/public';
	import { authClient } from '$lib/auth-client';
	import { getDeviceId, setDeviceId } from '$lib/identity';
	import { api } from '$convex/_generated/api';

	let { children } = $props();

	// Reuses the singleton created by initConvex() in hooks.ts; the URL is already
	// validated there, so a missing value would have failed loudly before this runs.
	setupConvex(env.PUBLIC_CONVEX_URL ?? '');
	// Wire Better Auth into the reactive Convex client (provides useAuth()).
	// authClient's plugin-augmented type doesn't structurally match the adapter's
	// narrower AuthClient union (version skew between @convex-dev/better-auth's
	// convexClient plugin types and the adapter's expected types); the client is
	// valid at runtime, so cast to the adapter's own arg type.
	createSvelteAuthClient({
		authClient
	} as unknown as Parameters<typeof createSvelteAuthClient>[0]);

	// Link-on-auth: when the user signs in, bind/merge this anonymous device into
	// their account and adopt the account principal (ADR-004 — same as sync
	// redeem). First sign-in claims this device (principal === deviceId, no
	// reload); a second device merges and adopts the principal, then reloads so
	// live queries re-subscribe under the account.
	const auth = useAuth();
	let linkAttempted = false;
	$effect(() => {
		if (!auth.isAuthenticated || linkAttempted) return;
		const deviceId = getDeviceId();
		if (!deviceId) return;
		linkAttempted = true;
		getConvexClient()
			.mutation(api.accounts.linkDevice, { deviceId })
			.then((r) => {
				if (r.principal !== deviceId) {
					setDeviceId(r.principal);
					location.reload();
				}
			})
			.catch((err) => console.error('[auth] linkDevice failed', err));
	});
</script>

{@render children()}
