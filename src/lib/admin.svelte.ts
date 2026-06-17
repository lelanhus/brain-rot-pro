import { browser } from '$app/environment';

/**
 * Client holder for the admin shared secret (ADR-008 phase B). This is only the
 * UX side of the gate — it decides whether to show the admin UI and what token
 * to send. The real enforcement is server-side (`assertAdmin`); a tampered
 * client just gets `unauthorized` back. Persisted in localStorage so a reload
 * doesn't re-prompt. Swap for a session/role once Better Auth lands (ADR-004).
 */
const KEY = 'brp_admin_token';

let token = $state(browser ? (localStorage.getItem(KEY) ?? '') : '');

export const adminAuth = {
	get token() {
		return token;
	},
	get hasToken() {
		return token.length > 0;
	},
	set(value: string) {
		token = value.trim();
		if (browser) localStorage.setItem(KEY, token);
	},
	clear() {
		token = '';
		if (browser) localStorage.removeItem(KEY);
	}
};
