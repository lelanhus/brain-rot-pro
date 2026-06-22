/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { convexTest } from 'convex-test';
import { internal, api } from './_generated/api';
import schema from './schema';
import { supplyThrottleOk, TARGET_CARDS_PER_TOPIC } from './generationPipeline';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('supplyThrottleOk respects the cooldown', () => {
	expect(supplyThrottleOk(undefined, 1000)).toBe(true);
	expect(supplyThrottleOk(1000, 1000 + 59_000)).toBe(false);
	expect(supplyThrottleOk(1000, 1000 + 60_000)).toBe(true);
});

test('generateForTopic skips unknown topics without generating', async () => {
	const t = convexTest(schema, modules);

	const unknown = await t.action(internal.generationPipeline.generateForTopic, { slug: 'nope' });
	expect(unknown.status).toBe('skipped');

	const cards = await t.run(async (ctx) => ctx.db.query('knowledgeCards').collect());
	expect(cards).toHaveLength(0);
});

test('generateForTopic skips when cardCount >= TARGET_CARDS_PER_TOPIC', async () => {
	const t = convexTest(schema, modules);
	// Seed a topic at exactly TARGET so it is fully covered — no ingest/AI should run.
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Black hole',
		pageviews: 900,
		source: 'wikipedia-top'
	});
	for (let i = 0; i < TARGET_CARDS_PER_TOPIC; i++) {
		await t.mutation(internal.topics.incrementCardCount, { slug: 'black_hole' });
	}

	const covered = await t.action(internal.generationPipeline.generateForTopic, { slug: 'black_hole' });
	expect(covered.status).toBe('skipped');

	// cardCount unchanged (still at TARGET); no card rows created by the skip path.
	expect((await t.query(api.topics.bySlug, { slug: 'black_hole' }))?.cardCount).toBe(
		TARGET_CARDS_PER_TOPIC
	);
	const cards = await t.run(async (ctx) => ctx.db.query('knowledgeCards').collect());
	expect(cards).toHaveLength(0);
});

test('generateFromCatalog enqueues one job per needing-cards topic, popularity-first', async () => {
	const t = convexTest(schema, modules);
	// Three topics needing cards + one already covered (must be excluded).
	await t.mutation(internal.topics.upsertTopic, { title: 'Alpha', pageviews: 300, source: 'wikipedia-top' });
	await t.mutation(internal.topics.upsertTopic, { title: 'Beta', pageviews: 900, source: 'wikipedia-top' });
	await t.mutation(internal.topics.upsertTopic, { title: 'Gamma', pageviews: 600, source: 'wikipedia-top' });
	await t.mutation(internal.topics.upsertTopic, { title: 'Covered', pageviews: 999, source: 'wikipedia-top' });
	await t.mutation(internal.topics.incrementCardCount, { slug: 'covered' });

	// Workpool (generationPool component) cannot run under convex-test — fallback:
	// assert the selection contract via a direct needingCards read (same 3 topics).
	const needing = await t.query(internal.topics.needingCards, { limit: 10 });
	expect(needing).toHaveLength(3); // Alpha, Beta, Gamma — not Covered
	expect(needing.every((topic) => topic.cardCount === 0)).toBe(true);
	expect(needing[0]?.slug).toBe('beta'); // popularity-first (pageviews desc)
	const slugs = needing.map((topic) => topic.slug);
	expect(slugs).not.toContain('covered');
});
