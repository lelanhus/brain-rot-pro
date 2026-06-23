/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

// ---------------------------------------------------------------------------
// Fetch-stub helpers
// ---------------------------------------------------------------------------

/** MediaWiki ACTION_API response for categories + pageprops (used by classifyTitle). */
function makeWikiResponse(
	pageid: number,
	title: string,
	wikibaseItem: string,
	categoryTitles: string[]
) {
	return {
		query: {
			pages: [
				{
					pageid,
					title,
					categories: categoryTitles.map((t) => ({ title: t })),
					pageprops: { wikibase_item: wikibaseItem }
				}
			]
		}
	};
}

/** Wikidata wbgetentities response for the given instanceOf QIDs. */
function makeWikidataResponse(qid: string, instanceOfIds: string[]) {
	return {
		entities: {
			[qid]: {
				claims: {
					P31: instanceOfIds.map((id) => ({
						mainsnak: { datavalue: { value: { id } } }
					}))
				}
			}
		}
	};
}

// ---------------------------------------------------------------------------
// classifyTitle — film (BLOCK) → evergreen:false
// ---------------------------------------------------------------------------

test('classifyTitle returns {evergreen:false} for a film (Wikidata Q11424 block)', async () => {
	const t = convexTest(schema, modules);

	// Two distinct HTTP calls: en.wikipedia.org and wikidata.org.
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (url.includes('wikipedia.org')) {
				return {
					ok: true,
					json: async () =>
						makeWikiResponse(12345, 'Inception', 'Q25188', ['2010 films', 'Science fiction films'])
				} as unknown as Response;
			}
			// wikidata.org — return film class Q11424
			return {
				ok: true,
				json: async () => makeWikidataResponse('Q25188', ['Q11424'])
			} as unknown as Response;
		})
	);

	const result = await t.action(internal.ingest.classifyTitle, { title: 'Inception' });
	expect(result).toEqual({ evergreen: false, ephemeral: false });

	vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// classifyTitle — evergreen science topic (ALLOW) → evergreen:true
// ---------------------------------------------------------------------------

test('classifyTitle returns {evergreen:true} for an evergreen taxon (Wikidata Q16521 allow)', async () => {
	const t = convexTest(schema, modules);

	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (url.includes('wikipedia.org')) {
				return {
					ok: true,
					json: async () =>
						makeWikiResponse(67890, 'Octopus', 'Q162616', ['Cephalopods', 'Marine biology'])
				} as unknown as Response;
			}
			// wikidata.org — taxon class Q16521
			return {
				ok: true,
				json: async () => makeWikidataResponse('Q162616', ['Q16521'])
			} as unknown as Response;
		})
	);

	const result = await t.action(internal.ingest.classifyTitle, { title: 'Octopus' });
	expect(result).toEqual({ evergreen: true, ephemeral: false });

	vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// classifyTitle — missing page → null
// ---------------------------------------------------------------------------

test('classifyTitle returns null for a missing/unresolvable page', async () => {
	const t = convexTest(schema, modules);

	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				({
					ok: true,
					json: async () => ({
						query: {
							pages: [{ title: 'Nonexistent Page XYZ', missing: true }]
						}
					})
				}) as unknown as Response
		)
	);

	const result = await t.action(internal.ingest.classifyTitle, { title: 'Nonexistent Page XYZ' });
	expect(result).toBeNull();

	vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// classifyTitle — recent-event topic (ephemeral) → ephemeral:true, evergreen:false
// ---------------------------------------------------------------------------

test('classifyTitle marks a recent-event topic ephemeral (and not evergreen)', async () => {
	const t = convexTest(schema, modules);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (url.includes('wikidata.org')) {
				return {
					ok: true,
					json: async () => ({
						entities: {
							Q1: {
								claims: {
									P31: [{ mainsnak: { datavalue: { value: { id: 'Q198' } } } }], // war → allow
									P585: [{ mainsnak: { datavalue: { value: { time: '+2026-06-01T00:00:00Z' } } } }]
								}
							}
						}
					})
				} as unknown as Response;
			}
			return {
				ok: true,
				json: async () => ({
					query: {
						pages: [
							{ pageid: 1, title: '2026 Iran war', categories: [], pageprops: { wikibase_item: 'Q1' } }
						]
					}
				})
			} as unknown as Response;
		})
	);

	const res = await t.action(internal.ingest.classifyTitle, { title: '2026 Iran war' });
	expect(res).toEqual({ evergreen: false, ephemeral: true });

	vi.unstubAllGlobals();
});
