import {
	initConvex,
	encodeConvexLoad,
	decodeConvexLoad,
	encodeConvexLoadPaginated,
	decodeConvexLoadPaginated
} from '@mmailaender/convex-svelte/sveltekit';
import { env } from '$env/dynamic/public';

// Fail fast, fail loud (engineering-standards §1): never silently run without a backend.
const convexUrl = env.PUBLIC_CONVEX_URL;
if (!convexUrl) {
	throw new Error(
		'PUBLIC_CONVEX_URL is not set. Copy .env.example to .env.local and run `npx convex dev`.'
	);
}

// Create the ConvexClient singleton early so the transport decoder can upgrade
// SSR data into a live WebSocket subscription after hydration.
initConvex(convexUrl);

export const transport = {
	ConvexLoadResult: { encode: encodeConvexLoad, decode: decodeConvexLoad },
	// Used by convexLoadPaginated() in the feed route.
	ConvexLoadPaginatedResult: {
		encode: encodeConvexLoadPaginated,
		decode: decodeConvexLoadPaginated
	}
};
