import type { Doc } from '$convex/_generated/dataModel';

/**
 * Return-to-feed resume.
 *
 * Navigating to /search or /account unmounts the feed component, and the card the
 * reader was on is already in `seenCards` (dwell fires `card_complete`/`card_skip`
 * on the way out), so a fresh `feed.unseen` refetch can never return them to it —
 * and scroll resets to the top. We snapshot the on-screen cards + the active card
 * on the way out (sessionStorage, survives the remount) and re-seed them on the
 * way back, landing the reader exactly where they left. New unseen cards still
 * append below via {@link mergeStableOrder} (it never drops the restored ids).
 */
export type FeedResume = {
	deviceId: string;
	activeId: string | null;
	cards: Doc<'knowledgeCards'>[];
};

// Bound the snapshot so sessionStorage stays small. Cards below the active one
// don't need persisting — they re-stream from the live feed on return.
const MAX_CARDS = 60;
const BUFFER_PAST_ACTIVE = 3;

/**
 * Build the snapshot to persist when leaving the feed: the cards from the top
 * through a small prefetch buffer past the active card, capped to `max` (dropping
 * the oldest top cards if the reader scrolled very far). Returns null when there
 * is nothing to resume (no device id, or an empty feed).
 */
export function buildResume(
	deviceId: string,
	activeId: string | null,
	cards: ReadonlyArray<Doc<'knowledgeCards'>>,
	max = MAX_CARDS
): FeedResume | null {
	if (deviceId === '' || cards.length === 0) return null;
	const activeIdx = activeId === null ? -1 : cards.findIndex((c) => c._id === activeId);
	const end =
		activeIdx < 0 ? cards.length : Math.min(cards.length, activeIdx + 1 + BUFFER_PAST_ACTIVE);
	const window = cards.slice(0, Math.max(end, 1)).slice(-max);
	if (window.length === 0) return null;
	return { deviceId, activeId, cards: window };
}

/** Whether a persisted snapshot can resume this device's feed. */
export function canResume(snap: FeedResume | null, deviceId: string): snap is FeedResume {
	return snap !== null && snap.deviceId === deviceId && snap.cards.length > 0;
}

/** Index of the slot to scroll back to on resume (the active card, else the top). */
export function resumeIndex(ids: ReadonlyArray<string>, activeId: string | null): number {
	if (activeId === null) return 0;
	const i = ids.indexOf(activeId);
	return i < 0 ? 0 : i;
}
