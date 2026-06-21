import { convexLoadPaginated } from 'convex-svelte/sveltekit';
import { api } from '$convex/_generated/api';

// SSR-to-live: the first page renders server-side (no loading flash), then
// upgrades to a live paginated subscription on the client (ADR-001).
// deviceId is client-only so SSR loads anonymously (deviceId: ''); seen
// exclusion activates once the client re-subscribes with the real deviceId.
export const load = async () => ({
	feed: await convexLoadPaginated(api.feed.unseen, { deviceId: '' }, { initialNumItems: 8 })
});
