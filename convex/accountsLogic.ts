/**
 * Pure rule for binding a signed-in user to a principal (the deviceId-style
 * account key). No account yet → claim this device's data as the account.
 * Already this device → nothing to do. A different device → merge it in.
 */
export function decideLink(
	existingPrincipal: string | null,
	deviceId: string
): { principal: string; action: 'claim' | 'merge' | 'noop' } {
	if (existingPrincipal === null) return { principal: deviceId, action: 'claim' };
	if (existingPrincipal === deviceId) return { principal: existingPrincipal, action: 'noop' };
	return { principal: existingPrincipal, action: 'merge' };
}
