import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('deleteData erases every trace of a device across all tables', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.seed.seed, {});
	const deviceId = 'doomed-device';
	const feed = await t.query(api.cards.feed, { paginationOpts: { numItems: 2, cursor: null } });

	// Build up a footprint: a save, events, a streak, a profile, a sync code.
	await t
		.withIdentity({ subject: deviceId })
		.mutation(api.saved.toggle, { deviceId, cardId: feed.page[0]._id });
	await t.withIdentity({ subject: deviceId }).mutation(api.events.log, {
		deviceId,
		sessionId: 's1',
		events: [{ type: 'card_complete', cardId: feed.page[0]._id, ts: 1 }]
	});
	await t.withIdentity({ subject: deviceId }).mutation(api.profile.recompute, { deviceId });
	await t.withIdentity({ subject: deviceId }).mutation(api.stats.recordActivity, { deviceId });
	await t.withIdentity({ subject: deviceId }).mutation(api.sync.createCode, { deviceId });

	await t.withIdentity({ subject: deviceId }).mutation(api.account.deleteData, { deviceId });

	// Everything keyed on the device is gone.
	expect(
		await t.withIdentity({ subject: deviceId }).query(api.saved.savedIds, { deviceId })
	).toHaveLength(0);
	expect(await t.withIdentity({ subject: deviceId }).query(api.stats.get, { deviceId })).toEqual({
		currentStreak: 0,
		longestStreak: 0,
		daysLearned: 0,
		lastActiveDay: ''
	});
	const leftovers = await t.run(async (ctx) => {
		const events = await ctx.db
			.query('events')
			.withIndex('by_device', (q) => q.eq('deviceId', deviceId))
			.collect();
		const codes = await ctx.db
			.query('syncCodes')
			.filter((q) => q.eq(q.field('deviceId'), deviceId))
			.collect();
		const profile = await ctx.db
			.query('userProfiles')
			.withIndex('by_device', (q) => q.eq('deviceId', deviceId))
			.unique();
		const seen = await ctx.db
			.query('seenCards')
			.withIndex('by_device', (q) => q.eq('deviceId', deviceId))
			.collect();
		return {
			events: events.length,
			codes: codes.length,
			profile: profile === null,
			seen: seen.length
		};
	});
	expect(leftovers).toEqual({ events: 0, codes: 0, profile: true, seen: 0 });
});

test('deleteData leaves other devices untouched', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.seed.seed, {});
	const feed = await t.query(api.cards.feed, { paginationOpts: { numItems: 1, cursor: null } });
	await t
		.withIdentity({ subject: 'keep' })
		.mutation(api.saved.toggle, { deviceId: 'keep', cardId: feed.page[0]._id });
	await t
		.withIdentity({ subject: 'erase' })
		.mutation(api.saved.toggle, { deviceId: 'erase', cardId: feed.page[0]._id });

	await t
		.withIdentity({ subject: 'erase' })
		.mutation(api.account.deleteData, { deviceId: 'erase' });

	expect(
		await t.withIdentity({ subject: 'keep' }).query(api.saved.savedIds, { deviceId: 'keep' })
	).toHaveLength(1);
});

test('deleteData requires a session (B1) and refuses to erase another device', async () => {
	const t = convexTest(schema, modules);
	// No session → rejected (can't erase anything).
	await expect(t.mutation(api.account.deleteData, { deviceId: 'victim' })).rejects.toThrow(
		/session is required/
	);
	// A session that doesn't own the target → rejected (no cross-device deletion).
	await expect(
		t.withIdentity({ subject: 'me' }).mutation(api.account.deleteData, { deviceId: 'victim' })
	).rejects.toThrow(/does not match/);
});
