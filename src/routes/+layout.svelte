<script lang="ts">
	import '../app.css';
	import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { env } from '$env/dynamic/public';
	import { authClient } from '$lib/auth-client';
	import { startDeviceSession } from '$lib/deviceSession.svelte';

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
	// Fail loud, not silent: an empty convexUrl would load a shell that fails
	// every query with cryptic network errors (docs/release-gates.md config gate).
	const convexUrl = env.PUBLIC_CONVEX_URL;
	if (convexUrl === undefined || convexUrl === '') {
		throw new Error(
			'PUBLIC_CONVEX_URL is not set — the app cannot reach its Convex backend. ' +
				'`npx convex dev` writes it for local dev; set it in the Vercel project env for deploys.'
		);
	}
	createSvelteAuthClient({
		authClient,
		convexUrl
	} as unknown as Parameters<typeof createSvelteAuthClient>[0]);

	// B1: establish an anonymous session (if none) and backfill the session-derived
	// deviceId every consumer keys on. Sign-in linking/merge is handled server-side
	// by the anonymous plugin's onLinkAccount (convex/auth.ts) — no client adopt or
	// reload needed, which also retires the old sync-code principal swap.
	startDeviceSession();
</script>

{@render children()}
