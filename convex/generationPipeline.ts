import { action, internalAction, internalMutation, internalQuery } from './_generated/server';
import { api, components, internal } from './_generated/api';
import { v } from 'convex/values';
import { Workpool } from '@convex-dev/workpool';
import { searchArticleTitles } from './ingest';

/**
 * Demand-driven generation pipeline (the "as users need more / on new interests"
 * loop). A bounded-concurrency, retrying Workpool turns in-demand concepts into
 * `needs_review` cards:
 *
 *   demand.topConcepts → search Wikipedia per concept → enqueue per-title jobs
 *   → [Workpool, max 2 at a time] ingest (fail-closed Commons image) + generate
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

/**
 * The entrypoint (cron- and manually-triggered). Reads real interest, fans out
 * one job per candidate title into the pool. Internal: triggering generation has
 * a cost, so it isn't publicly callable — the cron and ops (`run`) invoke it.
 */
export const processDemand = internalAction({
	args: { concepts: v.optional(v.number()), perConcept: v.optional(v.number()) },
	// Explicit return type breaks the self-referential inference cycle (this action
	// references its own deployment's `internal` api), as in generate.ts.
	handler: async (
		ctx,
		args
	): Promise<{
		concepts: string[];
		enqueued: number;
		plan: { concept: string; titles: string[] }[];
	}> => {
		const top = await ctx.runQuery(internal.demand.topConcepts, { limit: args.concepts ?? 4 });
		const plan: { concept: string; titles: string[] }[] = [];
		let enqueued = 0;
		for (const { concept } of top) {
			const titles = await searchArticleTitles(concept, args.perConcept ?? 2);
			plan.push({ concept, titles });
			for (const title of titles) {
				await pool.enqueueAction(ctx, internal.generationPipeline.ingestAndGenerate, {
					title,
					concept
				});
				enqueued++;
			}
		}
		return { concepts: top.map((t) => t.concept), enqueued, plan };
	}
});

/**
 * One Workpool job: ingest a single title (with its fail-closed Commons image),
 * then generate a card from it. Idempotent — skips if the article already yielded
 * a card, so a re-enqueued title never duplicates.
 */
export const ingestAndGenerate = internalAction({
	args: { title: v.string(), concept: v.optional(v.string()) },
	handler: async (
		ctx,
		{ title }
	): Promise<{
		title: string;
		status: 'filtered' | 'exists' | 'published' | 'validation_failed' | 'duplicate';
	}> => {
		const { articleId, accepted } = await ctx.runAction(internal.ingest.ingestOne, { title });
		if (!accepted || !articleId) return { title, status: 'filtered' };
		const already = await ctx.runQuery(internal.generateDb.articleHasCard, { articleId });
		if (already) return { title, status: 'exists' };
		const r = await ctx.runAction(api.generate.generateFromArticle, { articleId });
		return { title, status: r.status };
	}
});

/**
 * Manual trigger for demos/ops — same as the cron, runnable from the CLI:
 *   npx convex run generationPipeline:run '{"concepts":3,"perConcept":2}'
 */
export const run = action({
	args: { concepts: v.optional(v.number()), perConcept: v.optional(v.number()) },
	handler: async (ctx, args): Promise<unknown> =>
		ctx.runAction(internal.generationPipeline.processDemand, args)
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
		const now = Date.now();
		// Best-effort throttle: a rare concurrent double-trigger is acceptable (the
		// Workpool + per-run caps bound cost); strict at-most-once isn't needed here.
		const last: number | null = await ctx.runQuery(internal.generationPipeline.readSupplyState, {});
		if (!supplyThrottleOk(last ?? undefined, now)) return { triggered: false };
		await ctx.runMutation(internal.generationPipeline.markSupplyTriggered, { now });
		await ctx.runAction(internal.generationPipeline.processDemand, {
			concepts: 6,
			perConcept: 3
		});
		return { triggered: true };
	}
});
