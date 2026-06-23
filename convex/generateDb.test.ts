/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('overlongPublished returns only published cards over the cap', async () => {
	const t = convexTest(schema, modules);
	const articleId = await t.run(async (ctx) =>
		ctx.db.insert('sourceArticles', {
			pageId: 1,
			title: 'T',
			url: 'u',
			revisionId: 1,
			extract: '',
			paragraphs: ['p'],
			categories: [],
			status: 'fetched',
			fetchedAt: 0
		})
	);
	const base = {
		hook: 'h',
		body: 'placeholder',
		whyItMatters: 'w',
		format: 'object_story' as const,
		conceptTags: ['t'],
		shuffleKey: 0.5,
		createdAt: 0,
		source: {
			articleTitle: 'T',
			articleUrl: 'u',
			revisionId: 1 as number | null,
			sourceSpan: 's'
		},
		generation: {
			generationModel: 'gm',
			validationModel: 'vm',
			supportScore: 0.9,
			promptVersion: '1',
			sourceArticleId: articleId,
			generatedAt: 0
		}
	};
	await t.run(async (ctx) => {
		await ctx.db.insert('knowledgeCards', { ...base, body: 'a'.repeat(600), status: 'published' });
		await ctx.db.insert('knowledgeCards', { ...base, body: 'a'.repeat(100), status: 'published' });
		await ctx.db.insert('knowledgeCards', {
			...base,
			body: 'a'.repeat(600),
			status: 'suppressed'
		});
	});

	const rows = await t.query(internal.generateDb.overlongPublished, { cap: 480, limit: 50 });
	expect(rows).toHaveLength(1);
	expect(rows[0].articleId).toBe(articleId);
});

test('cardHooksForArticle returns hooks of published cards for the article', async () => {
	const t = convexTest(schema, modules);
	const articleId = await t.run(async (ctx) =>
		ctx.db.insert('sourceArticles', {
			pageId: 2,
			title: 'Octopus',
			url: 'u2',
			revisionId: 2,
			extract: '',
			paragraphs: ['p'],
			categories: [],
			status: 'fetched',
			fetchedAt: 0
		})
	);
	const base = {
		body: 'b',
		format: 'surprise_fact' as const,
		conceptTags: ['bio'],
		shuffleKey: 0.5,
		createdAt: 0,
		source: {
			articleTitle: 'Octopus',
			articleUrl: 'u2',
			revisionId: 2 as number | null,
			sourceSpan: 's'
		},
		generation: {
			generationModel: 'gm',
			validationModel: 'vm',
			supportScore: 0.9,
			promptVersion: '1',
			sourceArticleId: articleId,
			generatedAt: 0
		}
	};
	await t.run(async (ctx) => {
		await ctx.db.insert('knowledgeCards', { ...base, hook: 'hook-published', status: 'published' });
		await ctx.db.insert('knowledgeCards', {
			...base,
			hook: 'hook-failed',
			status: 'validation_failed'
		});
	});

	const hooks = await t.query(internal.generateDb.cardHooksForArticle, { articleId });
	// Only the published card's hook is returned.
	expect(hooks).toEqual(['hook-published']);
});
