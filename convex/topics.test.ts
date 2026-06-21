import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('upsertTopic inserts new topics and accumulates pageviews on duplicate slug', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Marie Curie',
		pageviews: 500,
		source: 'wikipedia-top'
	});
	// Same article, underscored variant on another day → same slug, summed views.
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Marie_Curie',
		pageviews: 300,
		source: 'wikipedia-top'
	});

	const rows = await t.run(async (ctx) => ctx.db.query('topics').collect());
	expect(rows).toHaveLength(1);
	expect(rows[0].slug).toBe('marie_curie');
	expect(rows[0].pageviews).toBe(800);
	expect(rows[0].cardCount).toBe(0);
});
