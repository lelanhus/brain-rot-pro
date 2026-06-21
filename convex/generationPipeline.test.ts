/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { convexTest } from 'convex-test';
import { internal, api } from './_generated/api';
import schema from './schema';
import { supplyThrottleOk } from './generationPipeline';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('supplyThrottleOk respects the cooldown', () => {
	expect(supplyThrottleOk(undefined, 1000)).toBe(true);
	expect(supplyThrottleOk(1000, 1000 + 59_000)).toBe(false);
	expect(supplyThrottleOk(1000, 1000 + 60_000)).toBe(true);
});

test('generateForTopic skips covered or unknown topics without generating', async () => {
	const t = convexTest(schema, modules);
	// A topic that already has a card must be skipped (no ingest/AI triggered).
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Black hole',
		pageviews: 900,
		source: 'wikipedia-top'
	});
	await t.mutation(internal.topics.incrementCardCount, { slug: 'black_hole' });

	const covered = await t.action(internal.generationPipeline.generateForTopic, { slug: 'black_hole' });
	expect(covered.status).toBe('skipped');

	const unknown = await t.action(internal.generationPipeline.generateForTopic, { slug: 'nope' });
	expect(unknown.status).toBe('skipped');

	// cardCount unchanged; no card rows created by the skip path.
	expect((await t.query(api.topics.bySlug, { slug: 'black_hole' }))?.cardCount).toBe(1);
	const cards = await t.run(async (ctx) => ctx.db.query('knowledgeCards').collect());
	expect(cards).toHaveLength(0);
});
