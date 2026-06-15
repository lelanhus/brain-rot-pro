import { convexLoadPaginated } from 'convex-svelte/sveltekit';
import { api } from '$convex/_generated/api';

// SSR-to-live: the first page renders server-side (no loading flash), then
// upgrades to a live paginated subscription on the client (ADR-001).
export const load = async () => ({
	feed: await convexLoadPaginated(api.cards.feed, {}, { initialNumItems: 8 })
});
