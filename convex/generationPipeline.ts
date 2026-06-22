import { action, internalAction, internalMutation, internalQuery } from './_generated/server';
import { api, components, internal } from './_generated/api';
import { v } from 'convex/values';
import { Workpool } from '@convex-dev/workpool';
import { publishedDelta, fillBudget, shouldKeepFilling } from './generateLogic';
import { evergreenFromStatus, TARGET_CARDS_PER_TOPIC } from './topicsLogic';

/**
 * Catalog-driven generation pipeline (the "warm-ahead" loop). A
 * bounded-concurrency, retrying Workpool turns catalog topics that lack cards
 * into `needs_review` cards:
 *
 *   topics.needingCards → [Workpool, max 2 at a time] generateForTopic
 *   → ingest (fail-closed Commons image) + generate
 *   → card lands `needs_review` (human publish gate unchanged)
 *
 * maxParallelism is deliberately low to stay polite to anonymous Wikimedia limits
 * and avoid AI-Gateway bursts; retries ride out transient HTTP/model failures.
 */
const pool = new Workpool(components.generationPool, {
	maxParallelism: 2,
	defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 1000, base: 2 },
	retryActionsByDefault: true
});

/** Topics to turn into cards per warm-ahead pass (bounded by Workpool maxParallelism + ensureSupply cooldown). */
export const CATALOG_BATCH = 10;

export { TARGET_CARDS_PER_TOPIC } from './topicsLogic';

/**
 * Warm-ahead supply: take the most-viewed catalog topics that still have no
 * cards and fan a generateForTopic job per topic through the bounded Workpool.
 */
export const generateFromCatalog = internalAction({
	args: { count: v.optional(v.number()) },
	handler: async (ctx, { count }): Promise<{ enqueued: number }> => {
		const topics = await ctx.runQuery(internal.topics.needingCards, { limit: count ?? CATALOG_BATCH });
		for (const topic of topics) {
			await pool.enqueueAction(ctx, internal.generationPipeline.generateForTopic, { slug: topic.slug });
		}
		return { enqueued: topics.length };
	}
});

/**
 * Turn one catalog topic into up to TARGET_CARDS_PER_TOPIC published cards. Idempotent:
 * a topic that is missing or already at TARGET is skipped before any ingest/AI work, so
 * re-enqueuing is safe. Ingests the article once, then loops generateFromArticle with
 * accumulated hooks so each pass surfaces a distinct angle. On each published result,
 * bumps the topic's cardCount.
 */
export const generateForTopic = internalAction({
	args: { slug: v.string() },
	handler: async (ctx, { slug }): Promise<{ status: string }> => {
		const topic = await ctx.runQuery(api.topics.bySlug, { slug });
		if (topic === null || topic.cardCount >= TARGET_CARDS_PER_TOPIC) return { status: 'skipped' };

		// Ingest the article once, then loop only the generation step so each
		// pass reuses the same source instead of re-ingesting per card.
		const { articleId, accepted } = await ctx.runAction(internal.ingest.ingestOne, {
			title: topic.title
		});
		if (!accepted || articleId === null) {
			await ctx.runMutation(internal.topics.setEvergreen, {
				slug,
				evergreen: evergreenFromStatus('filtered')
			});
			return { status: 'filtered' };
		}

		// `needed`/`maxAttempts` derive from current cardCount; the loop gates on
		// cards PUBLISHED this run (not avoidHooks.length), so a partial re-run
		// still fills toward TARGET even though avoidHooks is pre-seeded below.
		const budget = fillBudget(topic.cardCount, TARGET_CARDS_PER_TOPIC);
		// Seed avoidHooks from already-published cards for this article so a
		// re-run never regenerates angles that are already shipped.
		const avoidHooks: string[] = await ctx.runQuery(
			internal.generateDb.cardHooksForArticle,
			{ articleId }
		);
		let attempts = 0;
		let published = 0;
		let lastStatus = 'skipped';

		while (shouldKeepFilling(published, attempts, budget)) {
			attempts++;
			const r = await ctx.runAction(api.generate.generateFromArticle, {
				articleId,
				avoidHooks: avoidHooks.length > 0 ? avoidHooks : undefined
			});
			lastStatus = r.status;
			// Always set evergreen on the first result (once per topic).
			if (attempts === 1) {
				await ctx.runMutation(internal.topics.setEvergreen, {
					slug,
					evergreen: evergreenFromStatus(r.status)
				});
			}
			if (publishedDelta(r.status) > 0) {
				await ctx.runMutation(internal.topics.incrementCardCount, { slug });
				avoidHooks.push(r.hook);
				published++;
			}
		}

		return { status: lastStatus };
	}
});

/**
 * Manual trigger for demos/ops — same as the cron, runnable from the CLI:
 *   npx convex run generationPipeline:run '{"count":10}'
 */
export const run = action({
	args: { count: v.optional(v.number()) },
	handler: async (ctx, args): Promise<unknown> =>
		ctx.runAction(internal.generationPipeline.generateFromCatalog, args)
});

/** True if enough time has passed since the last supply trigger to trigger again. */
export function supplyThrottleOk(
	lastTriggeredAt: number | undefined,
	now: number,
	cooldownMs = 60_000
): boolean {
	return lastTriggeredAt === undefined || now - lastTriggeredAt >= cooldownMs;
}

export const readSupplyState = internalQuery({
	args: {},
	handler: async (ctx): Promise<number | null> => {
		const row = await ctx.db
			.query('supplyState')
			.withIndex('by_key', (q) => q.eq('key', 'global'))
			.unique();
		return row?.lastTriggeredAt ?? null;
	}
});

export const markSupplyTriggered = internalMutation({
	args: { now: v.number() },
	handler: async (ctx, { now }) => {
		const row = await ctx.db
			.query('supplyState')
			.withIndex('by_key', (q) => q.eq('key', 'global'))
			.unique();
		if (row !== null) await ctx.db.patch(row._id, { lastTriggeredAt: now });
		else await ctx.db.insert('supplyState', { key: 'global', lastTriggeredAt: now });
	}
});

/**
 * Throttled public action — clients call this when their unseen feed is running
 * low. Enqueues a generation pass at most once per minute (cooldown) so rapid
 * or concurrent calls don't spam the pipeline. Fire-and-forget from the client;
 * returns `{ triggered: true }` only when a pass was actually enqueued.
 */
export const ensureSupply = action({
	args: { deviceId: v.string() },
	returns: v.object({ triggered: v.boolean() }),
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	handler: async (ctx, _args): Promise<{ triggered: boolean }> => {
		// `deviceId` is accepted for client call-signature stability and future
		// per-device throttling, but is intentionally unused now — the throttle is
		// GLOBAL (single key:'global' row) because the library is shared, and cost
		// is bounded by the Workpool maxParallelism:2 cap + the 60s cooldown.
		const now = Date.now();
		// Best-effort throttle: a rare concurrent double-trigger is acceptable (the
		// Workpool + per-run caps bound cost); strict at-most-once isn't needed here.
		const last: number | null = await ctx.runQuery(internal.generationPipeline.readSupplyState, {});
		if (!supplyThrottleOk(last ?? undefined, now)) return { triggered: false };
		await ctx.runMutation(internal.generationPipeline.markSupplyTriggered, { now });
		await ctx.runAction(internal.generationPipeline.generateFromCatalog, { count: CATALOG_BATCH });
		return { triggered: true };
	}
});
