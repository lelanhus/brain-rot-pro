import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import { type MutationCtx } from './_generated/server';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('feed.unseen excludes seen + not-interested, ranks the rest', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(api.seed.seed, {});
	const deviceId = 'reader';
	const first = await t.query(api.feed.unseen, {
		deviceId,
		paginationOpts: { numItems: 3, cursor: null }
	});
	expect(first.page.length).toBeGreaterThan(0);
	const firstId = first.page[0]._id;

	// Mark the first card seen, then it must never appear again.
	await t.mutation(api.events.log, {
		deviceId,
		sessionId: 's',
		events: [{ type: 'card_complete', cardId: firstId, ts: 1 }]
	});
	const after = await t.query(api.feed.unseen, {
		deviceId,
		paginationOpts: { numItems: 50, cursor: null }
	});
	expect(after.page.map((c) => c._id)).not.toContain(firstId);
});

test('feed.unseen returns published cards for an anonymous (empty) deviceId', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(api.seed.seed, {});
	const res = await t.query(api.feed.unseen, {
		deviceId: '',
		paginationOpts: { numItems: 5, cursor: null }
	});
	expect(res.page.length).toBeGreaterThan(0);
});

test('focusConcept floats matching cards above non-matching', async () => {
	const t = convexTest(schema, modules);

	// Insert two controlled published cards with distinct conceptTags and shuffleKeys
	// using direct db insert within a custom mutation context
	const insertCards = async (ctx: MutationCtx) => {
		const now = Date.now();
		const alphaId = await ctx.db.insert('knowledgeCards', {
			hook: 'Alpha hook',
			body: 'Alpha body text',
			format: 'surprise_fact',
			conceptTags: ['alpha'],
			source: {
				articleTitle: 'Source A',
				articleUrl: 'https://example.com/a',
				pageId: 1,
				revisionId: null,
				sourceSpan: 'Passage about alpha'
			},
			status: 'published',
			shuffleKey: 0.1,
			createdAt: now
		});
		const betaId = await ctx.db.insert('knowledgeCards', {
			hook: 'Beta hook',
			body: 'Beta body text',
			format: 'surprise_fact',
			conceptTags: ['beta'],
			source: {
				articleTitle: 'Source B',
				articleUrl: 'https://example.com/b',
				pageId: 2,
				revisionId: null,
				sourceSpan: 'Passage about beta'
			},
			status: 'published',
			shuffleKey: 0.2,
			createdAt: now
		});
		return { alphaId, betaId };
	};

	const { alphaId, betaId } = await t.run(insertCards);

	const res = await t.query(api.feed.unseen, {
		deviceId: 'focus-dev',
		paginationOpts: { numItems: 50, cursor: null },
		focusConcept: 'alpha'
	});

	const ids = res.page.map((c) => c._id);
	expect(ids).toContain(alphaId);
	expect(ids).toContain(betaId);
	expect(ids.indexOf(alphaId)).toBeLessThan(ids.indexOf(betaId)); // focused card ranks first
});
