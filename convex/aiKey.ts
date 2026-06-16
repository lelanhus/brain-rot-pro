/**
 * Resolve the Vercel AI Gateway key from the Convex deployment env. The AI SDK's
 * default gateway provider reads `AI_GATEWAY_API_KEY`; we accept a few common
 * names and normalize, so it works whichever the operator set (matches the
 * generation pipeline's behavior).
 */
const KEY_CANDIDATES = [
	'AI_GATEWAY_API_KEY',
	'VERCEL_AI_GATEWAY_API_KEY',
	'AI_GATEWAY_KEY',
	'VERCEL_AI_GATEWAY_KEY',
	'GATEWAY_API_KEY'
];

/** Find a configured gateway key (name + value), or null if none is set. */
export function resolveGatewayKey(): { name: string; value: string } | null {
	for (const name of KEY_CANDIDATES) {
		const value = process.env[name];
		if (value) return { name, value };
	}
	return null;
}

/** Resolve and normalize the key into `AI_GATEWAY_API_KEY`, or throw loudly. */
export function requireGatewayKey(): void {
	const key = resolveGatewayKey();
	if (!key) {
		throw new Error(
			`No AI gateway key found. Set one of ${KEY_CANDIDATES.join(', ')} in the Convex deployment env.`
		);
	}
	process.env.AI_GATEWAY_API_KEY = key.value;
}
