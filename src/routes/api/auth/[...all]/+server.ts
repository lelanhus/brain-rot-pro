import { createSvelteKitHandler } from '@mmailaender/convex-better-auth-svelte/sveltekit';

// Proxies Better Auth requests from the SvelteKit app to the Convex component.
export const { GET, POST } = createSvelteKitHandler();
