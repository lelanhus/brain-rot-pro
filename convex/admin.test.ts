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
});
