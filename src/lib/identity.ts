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

let sessionId = '';
export function getSessionId(): string {
	if (!browser) return '';
	if (!sessionId) sessionId = crypto.randomUUID();
	return sessionId;
}
