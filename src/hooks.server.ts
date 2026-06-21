import type { Handle } from '@sveltejs/kit';
import { getToken } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { withServerConvexToken } from '@mmailaender/convex-svelte/sveltekit/server';

// Extract the Better Auth session token on every request and make it available
// to server-side Convex calls (SSR) via AsyncLocalStorage.
export const handle: Handle = async ({ event, resolve }) => {
	const token = getToken(event.cookies);
	event.locals.token = token;
	return withServerConvexToken(token, () => resolve(event));
};
