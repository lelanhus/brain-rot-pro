import { convexLoad } from '@mmailaender/convex-svelte/sveltekit';
import { api } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';

// SSR-load the shared card so link unfurlers (which don't run JS) get OG metadata,
// then upgrade to a live subscription on the client. A malformed id throws in the
// validator — caught here so a bad share URL shows a friendly "not available" page
// rather than a 500. `url.origin` gives the absolute canonical link for OG tags.
export const load = async ({ params, url }) => {
	try {
		const card = await convexLoad(api.cards.byId, { id: params.id as Id<'knowledgeCards'> });
		return { card, origin: url.origin };
	} catch {
		return { card: null, origin: url.origin };
	}
};
