import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('backfillSeen copies userProfiles.seen into seenCards, idempotently', async () => {
	const t = convexTest(schema, modules);
	const cardId = await t.run(async (ctx) =>
		ctx.db.insert('knowledgeCards', {
			hook: 'h',
			body: 'a'.repeat(100),
			format: 'object_story',
			conceptTags: ['t'],
			source: { articleTitle: 'T', articleUrl: 'u', revisionId: null, sourceSpan: 's' },
			status: 'published',
			shuffleKey: 0.5,
			createdAt: 0
		})
	);
	await t.run(async (ctx) =>
		ctx.db.insert('userProfiles', {
			deviceId: 'd1',
			conceptWeights: [],
			seen: [cardId],
			notInterested: [],
			updatedAt: 0
		})
	);

	const r1 = await t.mutation(internal.seenMigration.backfillSeen, { limit: 100 });
	expect(r1.rowsInserted).toBe(1);
	expect(r1.profilesScanned).toBe(1);
	const r2 = await t.mutation(internal.seenMigration.backfillSeen, { limit: 100 });
	expect(r2.rowsInserted).toBe(0); // idempotent
	expect(r2.profilesScanned).toBe(1); // profile still scanned even when nothing new inserted

	const rows = await t.run(async (ctx) =>
		ctx.db
			.query('seenCards')
			.withIndex('by_device', (q) => q.eq('deviceId', 'd1'))
			.collect()
	);
	expect(rows).toHaveLength(1);
	expect(rows[0].cardId).toBe(cardId);
});

test('backfillSeen with no profiles returns zero for both counters', async () => {
	const t = convexTest(schema, modules);
	const result = await t.mutation(internal.seenMigration.backfillSeen, { limit: 100 });
	expect(result).toEqual({ profilesScanned: 0, rowsInserted: 0 });
});
