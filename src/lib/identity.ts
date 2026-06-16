import { browser } from '$app/environment';

/**
 * Anonymous, pre-auth identity (ADR-004: no Better Auth in Phase 1). A stable
 * per-device id in localStorage, plus a per-page-load session id. Both are
 * empty on the server (SSR) and resolve on the client after hydration.
 */

const DEVICE_KEY = 'brp:deviceId';

export function getDeviceId(): string {
	if (!browser) return '';
	let id = localStorage.getItem(DEVICE_KEY);
	if (!id) {
		id = crypto.randomUUID();
		localStorage.setItem(DEVICE_KEY, id);
	}
	return id;
}

/**
 * Adopt a different anonymous account id (cross-device sync — ADR-004). Replaces
 * the stored device id so all subsequent queries key on the adopted account. The
 * caller should reload afterwards so live queries re-subscribe under the new id.
 */
export function setDeviceId(id: string): void {
	if (!browser) return;
	localStorage.setItem(DEVICE_KEY, id);
}

let sessionId = '';
export function getSessionId(): string {
	if (!browser) return '';
	if (!sessionId) sessionId = crypto.randomUUID();
	return sessionId;
}
