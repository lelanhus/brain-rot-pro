import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

const TOKEN = 'test-admin-token';
process.env.ADMIN_TOKEN = TOKEN;

test('overview requires a valid admin token', async () => {
	const t = convexTest(schema, modules);
	await expect(t.query(api.admin.overview, { token: 'wrong' })).rejects.toThrow(/authorization/i);
});

test('overview folds content, audience, engagement and monetization', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(api.seed.seed, {}); // seeds published cards

	const feed = await t.query(api.cards.feed, { paginationOpts: { numItems: 3, cursor: null } });
	const cardId = feed.page[0]._id;
	const offerId = await t.mutation(api.affiliate.add, {
		token: TOKEN,
		headline: 'H',
		blurb: 'B',
		url: 'https://example.com',
		conceptTags: ['x']
	});

	await t.mutation(api.saved.toggle, { deviceId: 'd1', cardId });
	await t.mutation(api.events.log, {
		deviceId: 'd1',
		sessionId: 's1',
		events: [
			{ type: 'card_impression', cardId, ts: 1 },
			{ type: 'card_impression', cardId, ts: 2 },
			{ type: 'card_complete', cardId, ts: 3 },
			{ type: 'sponsored_impression', offerId, ts: 4 },
			{ type: 'sponsored_click', offerId, ts: 5 }
		]
	});

	const o = await t.query(api.admin.overview, { token: TOKEN });

	expect(o.content.published).toBeGreaterThan(0);
	expect(o.content.cardsTotal).toBe(o.content.published); // seed publishes all
	expect(o.audience.saves).toBe(1);
	expect(o.engagement.impressions).toBe(2);
	expect(o.engagement.continuations).toBe(1);
	expect(o.engagement.ccr).toBeCloseTo(0.5);
	expect(o.monetization).toMatchObject({ impressions: 1, clicks: 1, ctr: 1 });
	expect(o.activity).toHaveLength(14);
});

test('accounts lists devices, and account returns detail; both gated', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(api.seed.seed, {});
	const feed = await t.query(api.cards.feed, { paginationOpts: { numItems: 2, cursor: null } });
	const cardId = feed.page[0]._id;

	await t.mutation(api.saved.toggle, { deviceId: 'dev-1', cardId });
	await t.mutation(api.stats.recordActivity, { deviceId: 'dev-1' });
	await t.mutation(api.events.log, {
		deviceId: 'dev-1',
		sessionId: 's1',
		events: [{ type: 'card_complete', cardId, ts: 1 }]
	});

	await expect(t.query(api.admin.accounts, { token: 'x' })).rejects.toThrow(/authorization/i);

	const list = await t.query(api.admin.accounts, { token: TOKEN });
	const row = list.find((r) => r.deviceId === 'dev-1');
	expect(row).toMatchObject({ saves: 1 });

	const detail = await t.query(api.admin.account, { token: TOKEN, deviceId: 'dev-1' });
	expect(detail.found).toBe(true);
	expect(detail.saved).toHaveLength(1);
	expect(detail.recentEvents.length).toBeGreaterThan(0);
});

test('cards search + setCardStatus moderation (gated)', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(api.seed.seed, {});
	const feed = await t.query(api.cards.feed, { paginationOpts: { numItems: 1, cursor: null } });
	const cardId = feed.page[0]._id;

	const published = await t.query(api.admin.cards, { token: TOKEN, status: 'published' });
	expect(published.length).toBeGreaterThan(0);

	await t.mutation(api.admin.setCardStatus, { token: TOKEN, cardId, status: 'suppressed' });
	const stillPublished = await t.query(api.admin.cards, { token: TOKEN, status: 'published' });
	expect(stillPublished.find((c) => c._id === cardId)).toBeUndefined();

	await expect(
		t.mutation(api.admin.setCardStatus, { token: 'nope', cardId, status: 'published' })
	).rejects.toThrow(/authorization/i);
});

test('setCardStatus refuses to publish a validation_failed card (§3.2)', async () => {
	const t = convexTest(schema, modules);
	const badId = await t.run(async (ctx) =>
		ctx.db.insert('knowledgeCards', {
			hook: 'Unsupported claim',
			body: 'Not entailed by its source.',
			format: 'surprise_fact',
			conceptTags: ['x'],
			source: { articleTitle: 'T', articleUrl: 'u', revisionId: null, sourceSpan: 's' },
			status: 'validation_failed',
			shuffleKey: 0.5,
			createdAt: 0
		})
	);
	await expect(
		t.mutation(api.admin.setCardStatus, { token: TOKEN, cardId: badId, status: 'published' })
	).rejects.toThrow(/cannot be published/i);
	// Suppressing it is still allowed.
	await t.mutation(api.admin.setCardStatus, { token: TOKEN, cardId: badId, status: 'suppressed' });
});
