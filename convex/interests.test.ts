import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('interests add (idempotent) / list / remove', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'dev1';
	await t.mutation(api.interests.add, { deviceId, slug: 'cleopatra', title: 'Cleopatra' });
	await t.mutation(api.interests.add, { deviceId, slug: 'cleopatra', title: 'Cleopatra' }); // dedupe
	let rows = await t.query(api.interests.list, { deviceId });
	expect(rows).toHaveLength(1);
	expect(rows[0].slug).toBe('cleopatra');
	expect(rows[0].source).toBe('explicit');

	await t.mutation(api.interests.remove, { deviceId, slug: 'cleopatra' });
	rows = await t.query(api.interests.list, { deviceId });
	expect(rows).toHaveLength(0);
});

test('addDiscovered inserts a discovered interest and dedupes', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'dd';
	await t.mutation(internal.interests.addDiscovered, { deviceId, slug: 'rome', title: 'Rome' });
	await t.mutation(internal.interests.addDiscovered, { deviceId, slug: 'rome', title: 'Rome' });
	const rows = await t.query(api.interests.list, { deviceId });
	expect(rows).toHaveLength(1);
	expect(rows[0].source).toBe('discovered');
});
