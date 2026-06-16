import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('recordActivity starts a streak and get reflects it', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'streak-device';

	const before = await t.query(api.stats.get, { deviceId });
	expect(before).toEqual({ currentStreak: 0, longestStreak: 0, daysLearned: 0, lastActiveDay: '' });

	const res = await t.mutation(api.stats.recordActivity, { deviceId });
	expect(res.event).toBe('started');
	expect(res.currentStreak).toBe(1);

	const after = await t.query(api.stats.get, { deviceId });
	expect(after.currentStreak).toBe(1);
	expect(after.daysLearned).toBe(1);
});

test('recordActivity is idempotent within the same day', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'idempotent-device';

	await t.mutation(api.stats.recordActivity, { deviceId });
	const second = await t.mutation(api.stats.recordActivity, { deviceId });

	expect(second.event).toBe('same_day');
	expect(second.currentStreak).toBe(1);
	expect(second.daysLearned).toBe(1); // not double-counted
});

test('recordActivity rejects an empty deviceId', async () => {
	const t = convexTest(schema, modules);
	await expect(t.mutation(api.stats.recordActivity, { deviceId: '' })).rejects.toThrow(
		/deviceId is required/
	);
});
