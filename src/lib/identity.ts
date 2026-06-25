import { browser } from '$app/environment';

/**
 * Per-page-load analytics session id (design doc §22.2). Distinct from the
 * device principal — which is now the Better Auth session subject, sourced from
 * `deviceSession.svelte` (B1), not a localStorage id. This id only groups events
 * within a single page load and never identifies the user.
 */

let sessionId = '';
export function getSessionId(): string {
	if (!browser) return '';
	if (!sessionId) sessionId = crypto.randomUUID();
	return sessionId;
}
