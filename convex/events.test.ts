import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

async function firstCardId(t: ReturnType<typeof convexTest>) {
	await t.mutation(internal.seed.seed, {});
	const page = await t.query(api.cards.feed, { paginationOpts: { numItems: 1, cursor: null } });
	return page.page[0]._id;
}

test('events.log writes the whole batch keyed to the device', async () => {
	const t = convexTest(schema, modules);
	const cardId = await firstCardId(t);
	const deviceId = 'device-a';

	const res = await t.withIdentity({ subject: deviceId }).mutation(api.events.log, {
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
		t
			.withIdentity({ subject: '' })
			.mutation(api.events.log, { deviceId: '', sessionId: 's', events: [] })
	).rejects.toThrow();
});

test('events.log records seenCards for seen-type events, idempotently', async () => {
	const t = convexTest(schema, modules);
	const cardId = await firstCardId(t);
	const deviceId = 'seen-device';
	await t.withIdentity({ subject: deviceId }).mutation(api.events.log, {
		deviceId,
		sessionId: 's1',
		events: [
			{ type: 'card_impression', cardId, ts: 1 },
			{ type: 'card_complete', cardId, ts: 2 } // same card again
		]
	});
	const rows = await t.run(async (ctx) =>
		ctx.db
			.query('seenCards')
			.withIndex('by_device', (q) => q.eq('deviceId', deviceId))
			.collect()
	);
	expect(rows).toHaveLength(1); // one row per (device, card), not per event
	expect(rows[0].cardId).toBe(cardId);
	expect(rows[0].seenAt).toBe(2); // max ts among the two same-card events (ts:1, ts:2)
});

test('saved.toggle is idempotent per (device, card); savedIds reflects it', async () => {
	const t = convexTest(schema, modules);
	const cardId = await firstCardId(t);
	const deviceId = 'device-b';

	const first = await t
		.withIdentity({ subject: deviceId })
		.mutation(api.saved.toggle, { deviceId, cardId });
	expect(first.saved).toBe(true);
	expect(
		await t.withIdentity({ subject: deviceId }).query(api.saved.savedIds, { deviceId })
	).toContain(cardId);

	const second = await t
		.withIdentity({ subject: deviceId })
		.mutation(api.saved.toggle, { deviceId, cardId });
	expect(second.saved).toBe(false);
	expect(
		await t.withIdentity({ subject: deviceId }).query(api.saved.savedIds, { deviceId })
	).not.toContain(cardId);
});
