import type { Id } from '$convex/_generated/dataModel';
import { dwellThresholdMs } from '$lib/metrics';
import { track } from '$lib/telemetry';

/**
 * Svelte action: tracks dwell on a card. Emits `card_impression` the first time
 * a card becomes prominently visible (per session), and on leaving emits
 * `card_complete` (dwell ≥ threshold) or `card_skip` (below) with the dwell ms.
 * Calls `onActive` so the feed knows which card keyboard actions target.
 */
const impressedThisSession = new Set<string>();

type Params = {
	cardId: Id<'knowledgeCards'>;
	body: string;
	onActive?: (cardId: Id<'knowledgeCards'>) => void;
};

export function dwell(node: HTMLElement, params: Params) {
	let current = params;
	let activeSince: number | null = null;

	function end() {
		if (activeSince === null) return;
		const visibleMs = Math.round(performance.now() - activeSince);
		activeSince = null;
		const type = visibleMs >= dwellThresholdMs(current.body) ? 'card_complete' : 'card_skip';
		track(type, { cardId: current.cardId, visibleMs });
	}

	const observer = new IntersectionObserver(
		(entries) => {
			const entry = entries[0];
			if (!entry) return;
			const isActive = entry.intersectionRatio >= 0.6;
			if (isActive && activeSince === null) {
				activeSince = performance.now();
				current.onActive?.(current.cardId);
				if (!impressedThisSession.has(current.cardId)) {
					impressedThisSession.add(current.cardId);
					track('card_impression', { cardId: current.cardId });
				}
			} else if (!isActive && activeSince !== null) {
				end();
			}
		},
		{ threshold: [0, 0.6, 1] }
	);
	observer.observe(node);

	return {
		update(next: Params) {
			current = next;
		},
		destroy() {
			end();
			observer.disconnect();
		}
	};
}
