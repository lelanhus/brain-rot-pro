import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('recordActivity starts a streak and get reflects it', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'streak-device';

	const before = await t.withIdentity({ subject: deviceId }).query(api.stats.get, { deviceId });
	expect(before).toEqual({ currentStreak: 0, longestStreak: 0, daysLearned: 0, lastActiveDay: '' });

	const res = await t
		.withIdentity({ subject: deviceId })
		.mutation(api.stats.recordActivity, { deviceId });
	expect(res.event).toBe('started');
	expect(res.currentStreak).toBe(1);

	const after = await t.withIdentity({ subject: deviceId }).query(api.stats.get, { deviceId });
	expect(after.currentStreak).toBe(1);
	expect(after.daysLearned).toBe(1);
});

test('recordActivity is idempotent within the same day', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'idempotent-device';

	await t.withIdentity({ subject: deviceId }).mutation(api.stats.recordActivity, { deviceId });
	const second = await t
		.withIdentity({ subject: deviceId })
		.mutation(api.stats.recordActivity, { deviceId });

	expect(second.event).toBe('same_day');
	expect(second.currentStreak).toBe(1);
	expect(second.daysLearned).toBe(1); // not double-counted
});

test('recordActivity requires a session (B1)', async () => {
	const t = convexTest(schema, modules);
	// No session → rejected.
	await expect(t.mutation(api.stats.recordActivity, { deviceId: 'someone' })).rejects.toThrow(
		/session is required/
	);
	// A session that doesn't own the claimed device → rejected.
	await expect(
		t.withIdentity({ subject: 'me' }).mutation(api.stats.recordActivity, { deviceId: 'other' })
	).rejects.toThrow(/does not match/);
});
