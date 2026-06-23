import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { TARGET_CARDS_PER_TOPIC } from './topicsLogic';

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
	// Give one topic TARGET cards so it is fully covered and excluded from needingCards.
	await t.run(async (ctx) => {
		const bh = await ctx.db
			.query('topics')
			.withIndex('by_slug', (q) => q.eq('slug', 'black_hole'))
			.unique();
		if (bh !== null) await ctx.db.patch(bh._id, { cardCount: TARGET_CARDS_PER_TOPIC });
	});

	const top = await t.query(api.topics.topByPageviews, { limit: 10 });
	expect(top.map((r) => r.slug)).toEqual(['black_hole', 'marie_curie']);

	const needing = await t.query(internal.topics.needingCards, { limit: 10 });
	expect(needing.map((r) => r.slug)).toEqual(['marie_curie']); // black_hole excluded (cardCount===TARGET)

	const found = await t.query(api.topics.search, { query: 'Marie', limit: 10 });
	expect(found.some((r) => r.slug === 'marie_curie')).toBe(true);

	const one = await t.query(api.topics.bySlug, { slug: 'black_hole' });
	expect(one?.title).toBe('Black hole');

	const none = await t.query(api.topics.search, { query: '   ', limit: 10 });
	expect(none).toEqual([]);
});

test('harvestTopDay filters noise and upserts the rest', async () => {
	const t = convexTest(schema, modules);
	const payload = {
		items: [
			{
				articles: [
					{ article: 'Marie_Curie', views: 1000 },
					{ article: 'Main_Page', views: 99999 }, // dropped
					{ article: 'Special:Search', views: 5000 }, // dropped
					{ article: 'Black_hole', views: 800 }
				]
			}
		]
	};
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok: true, json: async () => payload }) as unknown as Response)
	);

	const res = await t.action(internal.topics.harvestTopDay, { date: '2026-06-01' });
	expect(res).toEqual({ fetched: 4, kept: 2 });

	const rows = await t.run(async (ctx) => ctx.db.query('topics').collect());
	expect(rows.map((r) => r.slug).sort()).toEqual(['black_hole', 'marie_curie']);

	vi.unstubAllGlobals();
});

test('backfillCatalog walks days backward and advances the cursor', async () => {
	const t = convexTest(schema, modules);
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				({
					ok: true,
					json: async () => ({ items: [{ articles: [{ article: 'Octopus', views: 100 }] }] })
				}) as unknown as Response
		)
	);
	// Seed the cursor so the walk is deterministic (no reliance on Date.now()).
	await t.mutation(internal.topics.setBackfillCursor, { date: '2026-06-10' });

	const res = await t.action(internal.topics.backfillCatalog, { days: 3 });
	expect(res.harvested).toBe(3);

	const state = await t.query(internal.topics.readCatalogState, {});
	// Started one day before the seeded cursor (06-09) and walked back 3 days → 06-07.
	expect(state?.backfillCursorDate).toBe('2026-06-07');

	vi.unstubAllGlobals();
});

test('incrementCardCount bumps an existing topic and no-ops unknown slugs', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Marie Curie',
		pageviews: 500,
		source: 'wikipedia-top'
	});

	await t.mutation(internal.topics.incrementCardCount, { slug: 'marie_curie' });
	await t.mutation(internal.topics.incrementCardCount, { slug: 'marie_curie' });
	expect((await t.query(api.topics.bySlug, { slug: 'marie_curie' }))?.cardCount).toBe(2);

	// Unknown slug: no throw, no row created.
	await t.mutation(internal.topics.incrementCardCount, { slug: 'does_not_exist' });
	expect(await t.query(api.topics.bySlug, { slug: 'does_not_exist' })).toBeNull();
});

test('backfillCardCounts sets cardCount from published cards, skipping uncatalogued sources', async () => {
	const t = convexTest(schema, modules);
	// Catalog has Marie Curie; "Obscurity" is NOT catalogued.
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Marie Curie',
		pageviews: 500,
		source: 'wikipedia-top'
	});
	// Two published cards sourced from Marie Curie, one from an uncatalogued article.
	await t.run(async (ctx) => {
		// All required knowledgeCards fields (see schema.ts): hook, body, format,
		// conceptTags, source, status, shuffleKey, createdAt. Optional fields omitted.
		const base = {
			hook: 'h',
			body: 'b',
			format: 'surprise_fact' as const,
			conceptTags: ['science'],
			status: 'published' as const,
			shuffleKey: 0.5,
			createdAt: 1
		};
		const src = (articleTitle: string) => ({
			articleTitle,
			articleUrl: `https://en.wikipedia.org/wiki/${articleTitle}`,
			revisionId: null,
			sourceSpan: 's'
		});
		await ctx.db.insert('knowledgeCards', { ...base, source: src('Marie Curie') });
		await ctx.db.insert('knowledgeCards', { ...base, source: src('Marie_Curie') });
		await ctx.db.insert('knowledgeCards', { ...base, source: src('Obscurity') });
	});

	const res = await t.mutation(internal.topics.backfillCardCounts, {});
	expect(res.updated).toBe(1); // only Marie Curie matched the catalog

	const topic = await t.query(api.topics.bySlug, { slug: 'marie_curie' });
	expect(topic?.cardCount).toBe(2);
});

test('setEvergreen patches the verdict on a topic', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Sportsperson',
		pageviews: 99,
		source: 'wikipedia-top'
	});
	await t.mutation(internal.topics.setEvergreen, { slug: 'sportsperson', evergreen: false });
	expect((await t.query(api.topics.bySlug, { slug: 'sportsperson' }))?.evergreen).toBe(false);
});

test('topByPageviews and needingCards exclude evergreen===false (keep true + unclassified)', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Good',
		pageviews: 90,
		source: 'wikipedia-top'
	}); // undefined
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Junk',
		pageviews: 80,
		source: 'wikipedia-top'
	});
	await t.mutation(internal.topics.setEvergreen, { slug: 'junk', evergreen: false });
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Verified',
		pageviews: 70,
		source: 'wikipedia-top'
	});
	await t.mutation(internal.topics.setEvergreen, { slug: 'verified', evergreen: true });

	const top = (await t.query(api.topics.topByPageviews, { limit: 10 })).map((r) => r.slug);
	expect(top).toEqual(['good', 'verified']); // junk excluded
	const needing = (await t.query(internal.topics.needingCards, { limit: 10 })).map((r) => r.slug);
	expect(needing).toEqual(['good', 'verified']);
});

test('mergeStagingIntoCatalog drains staging into topics, preserving cardCount/evergreen', async () => {
	const t = convexTest(schema, modules);
	// existing topic with state that MUST be preserved
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Cleopatra',
		pageviews: 100,
		source: 'wikipedia-top'
	});
	await t.mutation(internal.topics.setEvergreen, { slug: 'cleopatra', evergreen: true });
	await t.mutation(internal.topics.incrementCardCount, { slug: 'cleopatra' });
	// staging: one dup (cleopatra) + one new (hannibal)
	await t.run(async (ctx) => {
		await ctx.db.insert('topicsStaging', { title: 'Cleopatra', slug: 'cleopatra', pageviews: 500 });
		await ctx.db.insert('topicsStaging', { title: 'Hannibal', slug: 'hannibal', pageviews: 300 });
	});

	const res = await t.mutation(internal.topics.mergeStagingIntoCatalog, { batch: 500 });
	expect(res).toEqual({ merged: 2, done: true });

	const cleo = await t.query(api.topics.bySlug, { slug: 'cleopatra' });
	expect(cleo?.cardCount).toBe(1); // preserved
	expect(cleo?.evergreen).toBe(true); // preserved
	expect(cleo?.pageviews).toBe(600); // 100 + 500 accumulated
	const han = await t.query(api.topics.bySlug, { slug: 'hannibal' });
	expect(han?.cardCount).toBe(0); // new insert
	expect(han?.source).toBe('wikipedia-dump');
	// staging drained
	expect(await t.run(async (ctx) => (await ctx.db.query('topicsStaging').collect()).length)).toBe(
		0
	);
});

test('purgeLowQuality deletes junk topics and keeps quality ones', async () => {
	const t = convexTest(schema, modules);
	await t.run(async (ctx) => {
		const mk = (title: string, slug: string) =>
			ctx.db.insert('topics', {
				title,
				slug,
				pageviews: 10,
				cardCount: 0,
				source: 'wikipedia-top',
				updatedAt: 1
			});
		await mk('.xyz', '.xyz');
		await mk('Deaths in 2026', 'deaths_in_2026');
		await mk('Cleopatra', 'cleopatra');
		await mk('Cristiano Ronaldo', 'cristiano_ronaldo');
	});
	const res = await t.mutation(internal.topics.purgeLowQuality, {});
	expect(res.deleted).toBe(2);
	const left = await t.run(async (ctx) => ctx.db.query('topics').collect());
	expect(left.map((r) => r.slug).sort()).toEqual(['cleopatra', 'cristiano_ronaldo']);
});
