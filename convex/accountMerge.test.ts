import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('mergeInto unions saves, re-points events, and drops the joining profile', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(api.seed.seed, {});
	const feed = await t.query(api.cards.feed, { paginationOpts: { numItems: 2, cursor: null } });
	const [c0, c1] = feed.page;

	// `from` saved c0 + has activity; `to` saved c1.
	await t.mutation(api.saved.toggle, { deviceId: 'from', cardId: c0._id });
	await t.mutation(api.saved.toggle, { deviceId: 'to', cardId: c1._id });
	await t.mutation(api.stats.recordActivity, { deviceId: 'from' });
	await t.mutation(api.events.log, {
		deviceId: 'from',
		sessionId: 's1',
		events: [{ type: 'card_complete', cardId: c0._id, ts: 1 }]
	});

	await t.mutation(internal.accountMerge.mergeInto, { from: 'from', to: 'to' });

	// Saves unioned onto `to`, and cleared from `from`.
	const toSaved = (await t.query(api.saved.savedIds, { deviceId: 'to' })).map(String).sort();
	expect(toSaved).toEqual([String(c0._id), String(c1._id)].sort());
	expect(await t.query(api.saved.savedIds, { deviceId: 'from' })).toHaveLength(0);

	// Events re-pointed to `to`.
	const fromEvents = await t.run(async (ctx) =>
		ctx.db
			.query('events')
			.withIndex('by_device', (q) => q.eq('deviceId', 'from'))
			.collect()
	);
	expect(fromEvents).toHaveLength(0);
});

test('mergeInto is a no-op when from === to', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(api.seed.seed, {});
	const feed = await t.query(api.cards.feed, { paginationOpts: { numItems: 1, cursor: null } });
	await t.mutation(api.saved.toggle, { deviceId: 'solo', cardId: feed.page[0]._id });

	await t.mutation(internal.accountMerge.mergeInto, { from: 'solo', to: 'solo' });

	expect(await t.query(api.saved.savedIds, { deviceId: 'solo' })).toHaveLength(1);
});
