import { query } from './_generated/server';
import { v } from 'convex/values';

// Keep in sync with src/lib/metrics.ts CONTINUATION_EVENTS (the unit-tested
// source of truth for the CCR definition).
const CONTINUATION_TYPES = ['card_complete', 'save', 'card_expand', 'source_open', 'related_tap'];

/**
 * Per-device event summary + CCR. Reads this device's events via the by_device
 * index. Fine for a single user; for a real user base this analytics rollup
 * should be precomputed (Aggregate component) rather than scanned (ADR-007).
 */
export const summary = query({
	args: { deviceId: v.string() },
	handler: async (ctx, args) => {
		if (args.deviceId.length === 0) {
			return { totalEvents: 0, impressions: 0, continuations: 0, ccr: 0, counts: {} };
		}
		const events = await ctx.db
			.query('events')
			.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
			.collect();

		const counts: Record<string, number> = {};
		for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;

		const impressions = counts['card_impression'] ?? 0;
		const continuations = CONTINUATION_TYPES.reduce((sum, t) => sum + (counts[t] ?? 0), 0);
		const ccr = impressions === 0 ? 0 : continuations / impressions;

		return { totalEvents: events.length, impressions, continuations, ccr, counts };
	}
});
