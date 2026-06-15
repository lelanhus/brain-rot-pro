import { browser } from '$app/environment';
import { getConvexClient } from 'convex-svelte';
import { api } from '$convex/_generated/api';
import type { Doc, Id } from '$convex/_generated/dataModel';
import { getDeviceId, getSessionId } from './identity';

/**
 * Client-side event buffer (design doc §22.2). Events are queued and flushed in
 * batches — non-blocking, resilient to reload (flush on hide/pagehide), and
 * never block the UI. Uses the module-singleton client (`getConvexClient`),
 * per the convex-svelte footgun rule (engineering-standards §2): never
 * `useQuery`/`useConvexClient` outside a component.
 */
// Single source of truth: the Convex `events` table's `type` union.
type EventType = Doc<'events'>['type'];

type QueuedEvent = {
	type: EventType;
	cardId?: Id<'knowledgeCards'>;
	visibleMs?: number;
	ts: number;
};

const FLUSH_INTERVAL_MS = 4000;
const FLUSH_AT = 25;

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export function track(
	type: EventType,
	opts: { cardId?: Id<'knowledgeCards'>; visibleMs?: number } = {}
): void {
	if (!browser) return;
	queue.push({ type, cardId: opts.cardId, visibleMs: opts.visibleMs, ts: Date.now() });
	if (queue.length >= FLUSH_AT) {
		void flush();
	} else if (!timer) {
		timer = setTimeout(() => void flush(), FLUSH_INTERVAL_MS);
	}
}

export async function flush(): Promise<void> {
	if (!browser || queue.length === 0) return;
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	const batch = queue;
	queue = [];
	try {
		await getConvexClient().mutation(api.events.log, {
			deviceId: getDeviceId(),
			sessionId: getSessionId(),
			events: batch
		});
	} catch (err) {
		// Don't silently drop events: requeue and surface (engineering-standards §1).
		queue = batch.concat(queue);
		console.error('[telemetry] flush failed; events requeued', err);
	}
}

/** Wire flush-on-hide. Returns a cleanup function. Call once from the feed. */
export function initTelemetry(): () => void {
	if (!browser) return () => {};
	const onVisibility = () => {
		if (document.visibilityState === 'hidden') void flush();
	};
	const onPageHide = () => void flush();
	document.addEventListener('visibilitychange', onVisibility);
	window.addEventListener('pagehide', onPageHide);
	return () => {
		document.removeEventListener('visibilitychange', onVisibility);
		window.removeEventListener('pagehide', onPageHide);
	};
}
