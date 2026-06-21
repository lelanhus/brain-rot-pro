/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('recompute stores a tasteVector from positively-engaged embedded cards', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'taste-dev';
	const cardId = await t.run(async (ctx) =>
		ctx.db.insert('knowledgeCards', {
			hook: 'h',
			body: 'a'.repeat(100),
			format: 'object_story',
			conceptTags: ['t'],
			source: { articleTitle: 'T', articleUrl: 'u', revisionId: null, sourceSpan: 's' },
			status: 'published',
			shuffleKey: 0.5,
			createdAt: 0,
			embedding: Array(1536)
				.fill(0)
				.map((_, i) => (i === 0 ? 1 : 0))
		})
	);
	await t.mutation(api.events.log, {
		deviceId,
		sessionId: 's',
		events: [{ type: 'save', cardId, ts: Date.now() }]
	});
	await t.mutation(api.profile.recompute, { deviceId });
	const profile = await t.run(async (ctx) =>
		ctx.db
			.query('userProfiles')
			.withIndex('by_device', (q) => q.eq('deviceId', deviceId))
			.unique()
	);
	expect(profile?.tasteVector).toBeDefined();
	expect(profile?.tasteVector?.length).toBe(1536);
});

test('recompute omits tasteVector at cold-start (no embedded positive engagement)', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'cold-dev';
	await t.mutation(api.profile.recompute, { deviceId });
	const profile = await t.run(async (ctx) =>
		ctx.db
			.query('userProfiles')
			.withIndex('by_device', (q) => q.eq('deviceId', deviceId))
			.unique()
	);
	expect(profile?.tasteVector).toBeUndefined();
});
