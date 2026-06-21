import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from './_generated/api';
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

test('read queries: search by title, top by pageviews, needingCards, bySlug', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Black hole',
		pageviews: 900,
		source: 'wikipedia-top'
	});
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Marie Curie',
		pageviews: 500,
		source: 'wikipedia-top'
	});
	// Give one topic cards so it is excluded from needingCards.
	await t.run(async (ctx) => {
		const bh = await ctx.db
			.query('topics')
			.withIndex('by_slug', (q) => q.eq('slug', 'black_hole'))
			.unique();
		if (bh !== null) await ctx.db.patch(bh._id, { cardCount: 2 });
	});

	const top = await t.query(api.topics.topByPageviews, { limit: 10 });
	expect(top.map((r) => r.slug)).toEqual(['black_hole', 'marie_curie']);

	const needing = await t.query(internal.topics.needingCards, { limit: 10 });
	expect(needing.map((r) => r.slug)).toEqual(['marie_curie']); // black_hole excluded (has cards)

	const found = await t.query(api.topics.search, { query: 'Marie', limit: 10 });
	expect(found.some((r) => r.slug === 'marie_curie')).toBe(true);

	const one = await t.query(api.topics.bySlug, { slug: 'black_hole' });
	expect(one?.title).toBe('Black hole');

	const none = await t.query(api.topics.search, { query: '   ', limit: 10 });
	expect(none).toEqual([]);
});
