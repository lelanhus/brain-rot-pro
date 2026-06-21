import { createAuthClient } from 'better-auth/svelte';
import { convexClient } from '@convex-dev/better-auth/client/plugins';

// Better Auth client (Google sign-in). The convexClient plugin routes auth
// calls through the Convex Better Auth component; createSvelteAuthClient in
// +layout.svelte wires this into the reactive Convex client.
export const authClient = createAuthClient({
	plugins: [convexClient()]
});
