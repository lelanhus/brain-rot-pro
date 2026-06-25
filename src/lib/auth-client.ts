import { createAuthClient } from 'better-auth/svelte';
import { anonymousClient } from 'better-auth/client/plugins';
import { convexClient } from '@convex-dev/better-auth/client/plugins';

// Better Auth client. `anonymousClient` exposes `signIn.anonymous()` so every
// first visit can establish a session (B1); `convexClient` routes auth calls
// through the Convex Better Auth component. createSvelteAuthClient in
// +layout.svelte wires this into the reactive Convex client.
export const authClient = createAuthClient({
	plugins: [anonymousClient(), convexClient()]
});
