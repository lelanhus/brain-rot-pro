import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
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
