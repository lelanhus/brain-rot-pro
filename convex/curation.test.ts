/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test, vi } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

const baseCard = {
	hook: 'h',
	body: 'b',
	format: 'surprise_fact' as const,
	conceptTags: ['t'],
	source: { articleTitle: 'X', articleUrl: 'https://en.wikipedia.org/wiki/X', revisionId: null, sourceSpan: 's' },
	shuffleKey: 0.5,
	createdAt: 0
};

describe('curation suppress/list', () => {
	test('listPublishedSources + suppressCards round-trip', async () => {
		const t = convexTest(schema, modules);
		const id = await t.run(async (ctx) =>
			ctx.db.insert('knowledgeCards', {
				...baseCard,
				source: { ...baseCard.source, articleTitle: 'Wombat' },
				status: 'published'
			})
		);
		const listed = await t.query(internal.curation.listPublishedSources, {});
		expect(listed).toEqual([{ cardId: id, title: 'Wombat' }]);

		const res = await t.mutation(internal.curation.suppressCards, { ids: [id] });
		expect(res).toEqual({ suppressed: 1 });
		const after = await t.run(async (ctx) => ctx.db.get(id));
		expect(after?.status).toBe('suppressed');
	});
});

describe('auditEphemeralPublished', () => {
	function stubClassify(ephemeralTitle: string) {
		// classifyTitle hits Action API then (if qid) Wikidata API. Return a recent
		// temporal claim only for the ephemeral title; an old one otherwise.
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: unknown) => {
				const body = String((init as { body?: string } | undefined)?.body ?? url);
				const isEphemeral = body.includes(encodeURIComponent(ephemeralTitle)) || url.includes(encodeURIComponent(ephemeralTitle));
				if (url.includes('wikidata.org')) {
					return {
						ok: true,
						json: async () => ({
							entities: {
								Q1: {
									claims: {
										P31: [{ mainsnak: { datavalue: { value: { id: 'Q198' } } } }],
										P585: [
											{
												mainsnak: {
													datavalue: { value: { time: isEphemeral ? '+2026-01-01T00:00:00Z' : '+1986-01-01T00:00:00Z' } }
												}
											}
										]
									}
								}
							}
						})
					} as unknown as Response;
				}
				const title = isEphemeral ? ephemeralTitle : 'Chernobyl disaster';
				return {
					ok: true,
					json: async () => ({
						query: { pages: [{ pageid: 1, title, categories: [], pageprops: { wikibase_item: 'Q1' } }] }
					})
				} as unknown as Response;
			})
		);
	}

	test('dry-run reports ephemeral cards without mutating; apply suppresses only those', async () => {
		const t = convexTest(schema, modules);
		const ephId = await t.run(async (ctx) =>
			ctx.db.insert('knowledgeCards', {
				...baseCard,
				source: { ...baseCard.source, articleTitle: '2026 Iran war' },
				status: 'published'
			})
		);
		const keepId = await t.run(async (ctx) =>
			ctx.db.insert('knowledgeCards', {
				...baseCard,
				source: { ...baseCard.source, articleTitle: 'Chernobyl disaster' },
				status: 'published'
			})
		);

		stubClassify('2026 Iran war');

		const dry = await t.action(api.curation.auditEphemeralPublished, {});
		expect(dry.wouldSuppress).toBe(1);
		expect(dry.applied).toBe(0);
		expect((await t.run((ctx) => ctx.db.get(ephId)))?.status).toBe('published');

		const applied = await t.action(api.curation.auditEphemeralPublished, { apply: true });
		expect(applied.applied).toBe(1);
		expect((await t.run((ctx) => ctx.db.get(ephId)))?.status).toBe('suppressed');
		expect((await t.run((ctx) => ctx.db.get(keepId)))?.status).toBe('published');

		vi.unstubAllGlobals();
	});
});
