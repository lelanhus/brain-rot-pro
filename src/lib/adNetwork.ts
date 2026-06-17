import { env } from '$env/dynamic/public';

/**
 * Ad-network slot config (ADR-008). This is the "just add your account" path:
 * once you're approved by a network, set these public env vars and the
 * sponsored slot is filled by the network — no per-ad work, no code change.
 * Until they're set, `getAdNetworkConfig()` returns null and the feed falls
 * back to the affiliate-offers provider (which works with no approval).
 *
 * AdSense is the first concrete target — its in-feed *native* unit is built to
 * sit inside a feed. Reuse the same shape for any `<ins>`-tag network later.
 *
 * Env vars (set in .env.local / the Vercel project):
 *   PUBLIC_AD_NETWORK    = "adsense"
 *   PUBLIC_AD_CLIENT     = "ca-pub-XXXXXXXXXXXXXXXX"
 *   PUBLIC_AD_SLOT       = "1234567890"           (the in-feed native ad unit id)
 *   PUBLIC_AD_LAYOUT_KEY = "-fb+5w+4e-db+86"      (optional, from the unit)
 */
export type AdNetworkConfig = {
	network: 'adsense';
	client: string;
	slot: string;
	layoutKey?: string;
};

export function getAdNetworkConfig(): AdNetworkConfig | null {
	if (env.PUBLIC_AD_NETWORK !== 'adsense') return null;
	const client = env.PUBLIC_AD_CLIENT;
	const slot = env.PUBLIC_AD_SLOT;
	if (!client || !slot) return null;
	return { network: 'adsense', client, slot, layoutKey: env.PUBLIC_AD_LAYOUT_KEY || undefined };
}
