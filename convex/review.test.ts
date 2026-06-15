import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

async function insertNeedsReview(t: ReturnType<typeof convexTest>) {
	return await t.run(async (ctx) => {
		const articleId = await ctx.db.insert('sourceArticles', {
			pageId: 1,
			title: 'Test',
			url: 'https://en.wikipedia.org/wiki/Test',
			revisionId: 1,
			extract: 'x',
			paragraphs: ['p'],
			categories: [],
			fetchedAt: 0,
			status: 'fetched' as const
		});
		return await ctx.db.insert('knowledgeCards', {
			hook: 'A generated hook about something true.',
			body: 'b'.repeat(120),
			format: 'surprise_fact' as const,
			conceptTags: ['t'],
			source: {
				articleTitle: 'Test',
				articleUrl: 'https://en.wikipedia.org/wiki/Test',
				pageId: 1,
				revisionId: 1,
				sourceSpan: 'a span from the source text here.'
			},
			status: 'needs_review' as const,
			generation: {
				generationModel: 'g',
				validationModel: 'v',
				supportScore: 0.9,
				promptVersion: 'gen-v1',
				sourceArticleId: articleId,
				generatedAt: 0
			},
			shuffleKey: 0.5,
			createdAt: 0
		});
	});
}

test('approve publishes a needs_review card into the feed', async () => {
	const t = convexTest(schema, modules);
	const cardId = await insertNeedsReview(t);

	expect((await t.query(api.review.queue, {})).map((c) => c._id)).toContain(cardId);

	const before = await t.query(api.cards.feed, { paginationOpts: { numItems: 50, cursor: null } });
	expect(before.page.map((c) => c._id)).not.toContain(cardId);

	await t.mutation(api.review.approve, { cardId });

	const after = await t.query(api.cards.feed, { paginationOpts: { numItems: 50, cursor: null } });
	expect(after.page.map((c) => c._id)).toContain(cardId);
	expect((await t.query(api.review.queue, {})).map((c) => c._id)).not.toContain(cardId);
});

test('reject keeps a card out of the feed', async () => {
	const t = convexTest(schema, modules);
	const cardId = await insertNeedsReview(t);
	await t.mutation(api.review.reject, { cardId });
	const feed = await t.query(api.cards.feed, { paginationOpts: { numItems: 50, cursor: null } });
	expect(feed.page.map((c) => c._id)).not.toContain(cardId);
});

test('approve only works on needs_review cards', async () => {
	const t = convexTest(schema, modules);
	const cardId = await insertNeedsReview(t);
	await t.mutation(api.review.approve, { cardId });
	await expect(t.mutation(api.review.approve, { cardId })).rejects.toThrow();
});
