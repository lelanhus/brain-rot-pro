import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

// Include the Convex function modules (and _generated/*.js), excluding test
// files and type-only declarations so convex-test doesn't try to register them.
const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('seed publishes cards; feed returns only published cards with provenance', async () => {
	const t = convexTest(schema, modules);
	const { inserted } = await t.mutation(api.seed.seed, {});
	expect(inserted).toBeGreaterThan(0);

	const firstPage = await t.query(api.cards.feed, {
		paginationOpts: { numItems: 5, cursor: null }
	});

	expect(firstPage.page.length).toBeGreaterThan(0);
	expect(firstPage.page.length).toBeLessThanOrEqual(5);
	for (const card of firstPage.page) {
		expect(card.status).toBe('published');
		// Provenance is mandatory (ADR-005 / review §3.3).
		expect(card.source.articleUrl).toMatch(/wikipedia\.org/);
		expect(card.source.sourceSpan.length).toBeGreaterThan(0);
	}
});

test('seed is idempotent (re-running does not duplicate)', async () => {
	const t = convexTest(schema, modules);
	const first = await t.mutation(api.seed.seed, {});
	const second = await t.mutation(api.seed.seed, {});
	expect(second.inserted).toBe(first.inserted);

	let cursor: string | null = null;
	let seen = 0;
	for (;;) {
		const page = await t.query(api.cards.feed, { paginationOpts: { numItems: 4, cursor } });
		seen += page.page.length;
		if (page.isDone) break;
		cursor = page.continueCursor;
	}
	expect(seen).toBe(first.inserted);
});
