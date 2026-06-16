import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import type { Id } from './_generated/dataModel';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

function card(hook: string, conceptTags: string[]) {
	return {
		hook,
		body: `${hook} (body)`,
		format: 'surprise_fact' as const,
		conceptTags,
		source: {
			articleTitle: 'T',
			articleUrl: 'https://en.wikipedia.org/wiki/T',
			revisionId: null,
			sourceSpan: 'span'
		},
		status: 'published' as const,
		shuffleKey: 0.5,
		createdAt: 0
	};
}

test('forCard falls back to concept overlap when the target has no embedding', async () => {
	const t = convexTest(schema, modules);

	const { target, near, far } = await t.run(async (ctx) => {
		const target = await ctx.db.insert('knowledgeCards', card('Rome', ['rome', 'history']));
		const near = await ctx.db.insert('knowledgeCards', card('Aqueducts', ['rome', 'engineering']));
		const far = await ctx.db.insert('knowledgeCards', card('Octopus', ['biology']));
		return { target, near, far };
	});

	const related = (await t.action(api.embeddings.forCard, { cardId: target })) as {
		_id: Id<'knowledgeCards'>;
	}[];
	const ids = related.map((c) => c._id);

	expect(ids).toContain(near); // shares the "rome" concept
	expect(ids).not.toContain(far); // no shared concept
	expect(ids).not.toContain(target); // never returns the source card itself
});

test('forCard returns nothing for a card that does not exist', async () => {
	const t = convexTest(schema, modules);
	const ghost = await t.run(async (ctx) => {
		const id = await ctx.db.insert('knowledgeCards', card('Temp', ['x']));
		await ctx.db.delete(id);
		return id;
	});
	const related = await t.action(api.embeddings.forCard, { cardId: ghost });
	expect(related).toEqual([]);
});
