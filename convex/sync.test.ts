import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { isValidCodeFormat, normalizeCode } from './syncLogic';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('a code minted on one device hands its account to another on redeem', async () => {
	const t = convexTest(schema, modules);

	const { code } = await t
		.withIdentity({ subject: 'device-A' })
		.mutation(api.sync.createCode, { deviceId: 'device-A' });
	expect(isValidCodeFormat(normalizeCode(code))).toBe(true);

	// Device B enters it with separators/lowercase, as a human would.
	const adopted = await t.withIdentity({ subject: 'device-B' }).mutation(api.sync.redeem, {
		code: `${code.slice(0, 4)}-${code.slice(4)}`,
		deviceId: 'device-B'
	});
	expect(adopted.deviceId).toBe('device-A'); // B adopts A's account id
	expect(adopted.merged).toBe(true);
});

test('a code is single-use', async () => {
	const t = convexTest(schema, modules);
	const { code } = await t
		.withIdentity({ subject: 'device-A' })
		.mutation(api.sync.createCode, { deviceId: 'device-A' });
	await t
		.withIdentity({ subject: 'device-B' })
		.mutation(api.sync.redeem, { code, deviceId: 'device-B' });
	await expect(
		t
			.withIdentity({ subject: 'device-C' })
			.mutation(api.sync.redeem, { code, deviceId: 'device-C' })
	).rejects.toThrow(/already been used/);
});

test('unknown and malformed codes are rejected loudly', async () => {
	const t = convexTest(schema, modules);
	await expect(
		t
			.withIdentity({ subject: 'device-B' })
			.mutation(api.sync.redeem, { code: 'ABCD2345', deviceId: 'device-B' })
	).rejects.toThrow(/not found/);
	await expect(
		t
			.withIdentity({ subject: 'device-B' })
			.mutation(api.sync.redeem, { code: 'nope', deviceId: 'device-B' })
	).rejects.toThrow(/not valid/);
});

test("minting a new code retires the device's previous one", async () => {
	const t = convexTest(schema, modules);
	const first = await t
		.withIdentity({ subject: 'device-A' })
		.mutation(api.sync.createCode, { deviceId: 'device-A' });
	await t
		.withIdentity({ subject: 'device-A' })
		.mutation(api.sync.createCode, { deviceId: 'device-A' });
	await expect(
		t
			.withIdentity({ subject: 'device-B' })
			.mutation(api.sync.redeem, { code: first.code, deviceId: 'device-B' })
	).rejects.toThrow(/not found/);
});

test('createCode requires a session (B1) and rejects a forged deviceId', async () => {
	const t = convexTest(schema, modules);
	// No session at all → rejected.
	await expect(t.mutation(api.sync.createCode, { deviceId: 'someone' })).rejects.toThrow(
		/session is required/
	);
	// A session that doesn't own the claimed device → rejected.
	await expect(
		t.withIdentity({ subject: 'me' }).mutation(api.sync.createCode, { deviceId: 'someone-else' })
	).rejects.toThrow(/does not match/);
});

test('redeem merges the joining device into the source account (saves + streak)', async () => {
	const t = convexTest(schema, modules);

	// Seed cards so both devices can save real ids.
	await t.mutation(internal.seed.seed, {});
	const feed = await t.query(api.cards.feed, { paginationOpts: { numItems: 3, cursor: null } });
	const cardA = feed.page[0]._id;
	const cardShared = feed.page[1]._id;
	const cardB = feed.page[2]._id;

	// Device A (the account that will survive): saves cardA + cardShared, a streak.
	await t
		.withIdentity({ subject: 'A' })
		.mutation(api.saved.toggle, { deviceId: 'A', cardId: cardA });
	await t
		.withIdentity({ subject: 'A' })
		.mutation(api.saved.toggle, { deviceId: 'A', cardId: cardShared });
	await t.withIdentity({ subject: 'A' }).mutation(api.stats.recordActivity, { deviceId: 'A' });

	// Device B: saves cardShared (dup) + cardB, its own streak.
	await t
		.withIdentity({ subject: 'B' })
		.mutation(api.saved.toggle, { deviceId: 'B', cardId: cardShared });
	await t
		.withIdentity({ subject: 'B' })
		.mutation(api.saved.toggle, { deviceId: 'B', cardId: cardB });
	await t.withIdentity({ subject: 'B' }).mutation(api.stats.recordActivity, { deviceId: 'B' });

	const { code } = await t
		.withIdentity({ subject: 'A' })
		.mutation(api.sync.createCode, { deviceId: 'A' });
	const res = await t
		.withIdentity({ subject: 'B' })
		.mutation(api.sync.redeem, { code, deviceId: 'B' });
	expect(res).toEqual({ deviceId: 'A', merged: true });

	// A now holds the union with no duplicate of cardShared.
	const savedA = await t
		.withIdentity({ subject: 'A' })
		.query(api.saved.savedIds, { deviceId: 'A' });
	expect(new Set(savedA.map(String))).toEqual(new Set([cardA, cardShared, cardB].map(String)));
	expect(savedA.length).toBe(3);

	// B no longer carries the moved saves.
	const savedB = await t
		.withIdentity({ subject: 'B' })
		.query(api.saved.savedIds, { deviceId: 'B' });
	expect(savedB).toHaveLength(0);

	// The merged streak survives on A; B's stats row is gone.
	const statsA = await t.withIdentity({ subject: 'A' }).query(api.stats.get, { deviceId: 'A' });
	expect(statsA.currentStreak).toBeGreaterThanOrEqual(1);
	const statsB = await t.withIdentity({ subject: 'B' }).query(api.stats.get, { deviceId: 'B' });
	expect(statsB).toEqual({ currentStreak: 0, longestStreak: 0, daysLearned: 0, lastActiveDay: '' });
});
