import { browser } from '$app/environment';

/** The canonical shareable URL for a card (the `/c/[id]` deep link). */
function cardUrl(cardId: string): string {
	const origin = browser ? location.origin : '';
	return `${origin}/c/${cardId}`;
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Share a card: native share sheet where available (mobile/PWA), else copy the
 * link to the clipboard. Returns what happened so the caller can confirm the copy
 * (e.g. an inline "Copied" state). A user-cancelled share sheet is `cancelled`,
 * not a failure.
 */
export async function shareCard(cardId: string, hook: string): Promise<ShareResult> {
	if (!browser) return 'failed';
	const url = cardUrl(cardId);
	const data: ShareData = { title: 'Wonderwell', text: hook, url };

	if (typeof navigator.share === 'function' && navigator.canShare?.(data) !== false) {
		try {
			await navigator.share(data);
			return 'shared';
		} catch (err) {
			// The user dismissing the native sheet throws AbortError — not an error.
			if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
			// Otherwise fall through to the copy fallback.
		}
	}

	try {
		await navigator.clipboard.writeText(url);
		return 'copied';
	} catch {
		return 'failed';
	}
}
