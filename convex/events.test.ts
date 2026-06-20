import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

async function firstCardId(t: ReturnType<typeof convexTest>) {
	await t.mutation(api.seed.seed, {});
	const page = await t.query(api.cards.feed, { paginationOpts: { numItems: 1, cursor: null } });
	return page.page[0]._id;
}

test('events.log writes the whole batch keyed to the device', async () => {
	const t = convexTest(schema, modules);
	const cardId = await firstCardId(t);
	const deviceId = 'device-a';

	const res = await t.mutation(api.events.log, {
		deviceId,
		sessionId: 'sess-1',
		events: [
			{ type: 'card_impression', cardId, ts: 1 },
			{ type: 'card_complete', cardId, visibleMs: 3000, ts: 2 },
			{ type: 'card_impression', cardId, ts: 3 },
			{ type: 'card_skip', cardId, visibleMs: 100, ts: 4 }
		]
	});
	expect(res.logged).toBe(4);

	const stored = await t.run(async (ctx) =>
		ctx.db
			.query('events')
			.withIndex('by_device', (q) => q.eq('deviceId', deviceId))
			.collect()
	);
	expect(stored).toHaveLength(4);
});

test('events.log fails fast on empty identity', async () => {
	const t = convexTest(schema, modules);
	await expect(
		t.mutation(api.events.log, { deviceId: '', sessionId: 's', events: [] })
	).rejects.toThrow();
});

test('saved.toggle is idempotent per (device, card); savedIds reflects it', async () => {
	const t = convexTest(schema, modules);
	const cardId = await firstCardId(t);
	const deviceId = 'device-b';

	const first = await t.mutation(api.saved.toggle, { deviceId, cardId });
	expect(first.saved).toBe(true);
	expect(await t.query(api.saved.savedIds, { deviceId })).toContain(cardId);

	const second = await t.mutation(api.saved.toggle, { deviceId, cardId });
	expect(second.saved).toBe(false);
	expect(await t.query(api.saved.savedIds, { deviceId })).not.toContain(cardId);
});
