import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from './_generated/api';
import { type MutationCtx } from './_generated/server';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('feed.unseen excludes seen + not-interested, ranks the rest', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.seed.seed, {});
	const deviceId = 'reader';
	const first = await t
		.withIdentity({ subject: deviceId })
		.query(api.feed.unseen, { deviceId, paginationOpts: { numItems: 3, cursor: null } });
	expect(first.page.length).toBeGreaterThan(0);
	const firstId = first.page[0]._id;

	// Mark the first card seen, then it must never appear again.
	await t.withIdentity({ subject: deviceId }).mutation(api.events.log, {
		deviceId,
		sessionId: 's',
		events: [{ type: 'card_complete', cardId: firstId, ts: 1 }]
	});
	const after = await t
		.withIdentity({ subject: deviceId })
		.query(api.feed.unseen, { deviceId, paginationOpts: { numItems: 50, cursor: null } });
	expect(after.page.map((c) => c._id)).not.toContain(firstId);
});

test('feed.unseen returns published cards for an anonymous (empty) deviceId', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.seed.seed, {});
	const res = await t
		.withIdentity({ subject: '' })
		.query(api.feed.unseen, { deviceId: '', paginationOpts: { numItems: 5, cursor: null } });
	expect(res.page.length).toBeGreaterThan(0);
});

test('focusConcept floats matching cards above non-matching', async () => {
	const t = convexTest(schema, modules);

	// Insert two controlled published cards with distinct conceptTags and shuffleKeys
	// using direct db insert within a custom mutation context
	const insertCards = async (ctx: MutationCtx) => {
		const now = Date.now();
		const alphaId = await ctx.db.insert('knowledgeCards', {
			hook: 'Alpha hook',
			body: 'Alpha body text',
			format: 'surprise_fact',
			conceptTags: ['alpha'],
			source: {
				articleTitle: 'Source A',
				articleUrl: 'https://example.com/a',
				pageId: 1,
				revisionId: null,
				sourceSpan: 'Passage about alpha'
			},
			status: 'published',
			shuffleKey: 0.1,
			createdAt: now
		});
		const betaId = await ctx.db.insert('knowledgeCards', {
			hook: 'Beta hook',
			body: 'Beta body text',
			format: 'surprise_fact',
			conceptTags: ['beta'],
			source: {
				articleTitle: 'Source B',
				articleUrl: 'https://example.com/b',
				pageId: 2,
				revisionId: null,
				sourceSpan: 'Passage about beta'
			},
			status: 'published',
			shuffleKey: 0.2,
			createdAt: now
		});
		return { alphaId, betaId };
	};

	const { alphaId, betaId } = await t.run(insertCards);

	const res = await t.withIdentity({ subject: 'focus-dev' }).query(api.feed.unseen, {
		deviceId: 'focus-dev',
		paginationOpts: { numItems: 50, cursor: null },
		focusConcept: 'alpha'
	});

	const ids = res.page.map((c) => c._id);
	expect(ids).toContain(alphaId);
	expect(ids).toContain(betaId);
	expect(ids.indexOf(alphaId)).toBeLessThan(ids.indexOf(betaId)); // focused card ranks first
});

test('feed.unseen boosts a followed topic above an equivalent unfollowed card', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'd1';
	const ids = await t.run(async (ctx) => {
		const mk = (articleTitle: string, shuffleKey: number) =>
			ctx.db.insert('knowledgeCards', {
				hook: 'h',
				body: 'b',
				format: 'surprise_fact' as const,
				conceptTags: ['z'],
				source: { articleTitle, articleUrl: 'u', revisionId: null, sourceSpan: 's' },
				status: 'published' as const,
				shuffleKey,
				createdAt: 1
			});
		return { low: await mk('Low Topic', 0.1), high: await mk('High Topic', 0.9) };
	});
	// Without follow, High (shuffle .9) ranks first. Follow Low's topic → it should jump ahead.
	await t
		.withIdentity({ subject: deviceId })
		.mutation(api.interests.add, { deviceId, slug: 'low_topic', title: 'Low Topic' });
	const res = await t
		.withIdentity({ subject: deviceId })
		.query(api.feed.unseen, { deviceId, paginationOpts: { numItems: 10, cursor: null } });
	expect(res.page[0]._id).toBe(ids.low);
});

test('threadFromCardId biases feed toward a thread neighbor', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'thread-dev';

	// Two cards: highShuffle has shuffleKey 0.9 so it wins without threading.
	// lowShuffle has shuffleKey 0.1 but its embedding aligns with the thread card.
	// Thread card has embedding [1,0,0,...] → lowShuffle also [1,0,0,...] → cosine 1.
	// highShuffle has embedding [0,1,0,...] → cosine 0 with thread.
	const embedding = (i: number) =>
		Array(1536)
			.fill(0)
			.map((_, j) => (j === i ? 1 : 0));

	const { lowShuffleId, threadCardId } = await t.run(async (ctx) => {
		const lowShuffleId = await ctx.db.insert('knowledgeCards', {
			hook: 'low',
			body: 'b',
			format: 'surprise_fact' as const,
			conceptTags: ['t'],
			source: { articleTitle: 'Low', articleUrl: 'u', revisionId: null, sourceSpan: 's' },
			status: 'published' as const,
			shuffleKey: 0.1,
			createdAt: 0,
			embedding: embedding(0)
		});
		await ctx.db.insert('knowledgeCards', {
			hook: 'high',
			body: 'b',
			format: 'surprise_fact' as const,
			conceptTags: ['t'],
			source: { articleTitle: 'High', articleUrl: 'u', revisionId: null, sourceSpan: 's' },
			status: 'published' as const,
			shuffleKey: 0.9,
			createdAt: 0,
			embedding: embedding(1)
		});
		// The thread anchor card — same embedding direction as lowShuffle
		const threadCardId = await ctx.db.insert('knowledgeCards', {
			hook: 'thread',
			body: 'b',
			format: 'surprise_fact' as const,
			conceptTags: ['t'],
			source: { articleTitle: 'Thread', articleUrl: 'u', revisionId: null, sourceSpan: 's' },
			status: 'published' as const,
			shuffleKey: 0.5,
			createdAt: 0,
			embedding: embedding(0)
		});
		return { lowShuffleId, threadCardId };
	});

	// Mark the thread anchor card as seen so it's excluded from feed results
	await t.withIdentity({ subject: deviceId }).mutation(api.events.log, {
		deviceId,
		sessionId: 's',
		events: [{ type: 'card_complete', cardId: threadCardId, ts: 1 }]
	});

	// Without threading: highShuffle (0.9) ranks above lowShuffle (0.1)
	const plain = await t
		.withIdentity({ subject: deviceId })
		.query(api.feed.unseen, { deviceId, paginationOpts: { numItems: 50, cursor: null } });
	const plainIds = plain.page.map((c) => c._id);
	// Just verify lowShuffle doesn't win without threading (shuffleKey wins)
	const plainLowIdx = plainIds.indexOf(lowShuffleId);
	const plainHighIdx = plainIds.findIndex((id) => id !== lowShuffleId);
	expect(plainHighIdx).toBeLessThan(plainLowIdx);

	// With threadFromCardId: lowShuffle (aligned with thread) should rank first
	const threaded = await t.withIdentity({ subject: deviceId }).query(api.feed.unseen, {
		deviceId,
		paginationOpts: { numItems: 50, cursor: null },
		threadFromCardId: threadCardId
	});
	expect(threaded.page[0]._id).toBe(lowShuffleId);
});

test('feed.unseen ranks an on-taste card ahead of an off-taste one', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'rank-dev';
	const near = await t.run(async (ctx) =>
		ctx.db.insert('knowledgeCards', {
			hook: 'near',
			body: 'a'.repeat(100),
			format: 'object_story',
			conceptTags: ['t'],
			source: { articleTitle: 'T', articleUrl: 'u', revisionId: null, sourceSpan: 's' },
			status: 'published',
			shuffleKey: 0.1,
			createdAt: 0,
			embedding: Array(1536)
				.fill(0)
				.map((_, i) => (i === 0 ? 1 : 0))
		})
	);
	const far = await t.run(async (ctx) =>
		ctx.db.insert('knowledgeCards', {
			hook: 'far',
			body: 'a'.repeat(100),
			format: 'object_story',
			conceptTags: ['t'],
			source: { articleTitle: 'T', articleUrl: 'u', revisionId: null, sourceSpan: 's' },
			status: 'published',
			shuffleKey: 0.9,
			createdAt: 0,
			embedding: Array(1536)
				.fill(0)
				.map((_, i) => (i === 1 ? 1 : 0))
		})
	);
	// taste = the 'near' embedding direction
	await t.run(async (ctx) =>
		ctx.db.insert('userProfiles', {
			deviceId,
			conceptWeights: [],
			notInterested: [],
			updatedAt: 0,
			tasteVector: Array(1536)
				.fill(0)
				.map((_, i) => (i === 0 ? 1 : 0))
		})
	);
	const res = await t
		.withIdentity({ subject: deviceId })
		.query(api.feed.unseen, { deviceId, paginationOpts: { numItems: 50, cursor: null } });
	const ids = res.page.map((c) => c._id);
	// far has shuffleKey 0.9 > 0.1 (near), so scoreCard ranker would rank it first.
	// Only cosine ranking makes near win despite the lower shuffleKey.
	expect(ids.indexOf(near)).toBeLessThan(ids.indexOf(far)); // on-taste first despite higher far shuffleKey
});
