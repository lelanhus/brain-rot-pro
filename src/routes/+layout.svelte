<script lang="ts">
	import '../app.css';
	import { useAuth, getConvexClient } from 'convex-svelte';
	import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { env } from '$env/dynamic/public';
	import { authClient } from '$lib/auth-client';
	import { getDeviceId, setDeviceId } from '$lib/identity';
	import { api } from '$convex/_generated/api';

	let { children } = $props();

	// createSvelteAuthClient is the SINGLE Convex client setup for the reactive
	// layer: it calls setupConvex() internally (via resolveConvexClient) and wires
	// Better Auth session state into that client, so useAuth()/useQuery() all
	// resolve from one shared context. Calling setupConvex() separately would
	// double-initialize the context. convexUrl is passed explicitly because the
	// app reads it from $env/dynamic/public (the adapter defaults to the static
	// PUBLIC_CONVEX_URL otherwise).
	// (Cast: authClient's plugin-augmented type doesn't structurally match the
	// adapter's narrower AuthClient union; it's valid at runtime.)
	createSvelteAuthClient({
		authClient,
		convexUrl: env.PUBLIC_CONVEX_URL ?? ''
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
