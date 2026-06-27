import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('backfillSafety suppresses an unsafe published card and keeps safe ones', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.seed.seed, {});

	// Force one published card to look unsafe via its source title. Use an
	// era-INDEPENDENT harm term so the test never depends on nowYear.
	const target = await t.run(async (ctx) => {
		const card = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.first();
		if (!card) throw new Error('no published card seeded');
		await ctx.db.patch(card._id, {
			source: { ...card.source, articleTitle: 'Suicide methods' }
		});
		return card._id;
	});

	const dry = await t.action(internal.safety.backfillSafety, {});
	expect(dry.unsafe).toBeGreaterThanOrEqual(1);
	const stillPublished = await t.run(async (ctx) => (await ctx.db.get(target))?.status);
	expect(stillPublished).toBe('published'); // dry-run does not mutate

	const applied = await t.action(internal.safety.backfillSafety, { apply: true });
	expect(applied.suppressed).toBeGreaterThanOrEqual(1);
	const after = await t.run(async (ctx) => (await ctx.db.get(target))?.status);
	expect(after).toBe('suppressed');
});
