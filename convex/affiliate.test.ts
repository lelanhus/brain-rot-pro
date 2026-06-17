import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { DISCLOSURE } from './affiliateLogic';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

// Admin functions require this shared secret (assertAdmin reads process.env).
const TOKEN = 'test-admin-token';
process.env.ADMIN_TOKEN = TOKEN;

test('add → active surfaces the offer with the network default disclosure', async () => {
	const t = convexTest(schema, modules);
	const id = await t.mutation(api.affiliate.add, {
		token: TOKEN,
		headline: 'Engineering an Empire',
		blurb: 'How Rome built to last.',
		url: 'https://bookshop.org/a/123/x',
		conceptTags: ['rome', 'engineering']
	});

	const active = await t.query(api.affiliate.active, {});
	expect(active).toHaveLength(1);
	expect(active[0]._id).toBe(id);
	expect(active[0].network).toBe('bookshop'); // default program
	expect(active[0].disclosure).toBe(DISCLOSURE.bookshop); // default disclosure
	expect(active[0].cta).toBe('Learn more'); // default CTA
});

test('admin functions reject a missing or wrong token', async () => {
	const t = convexTest(schema, modules);
	await expect(
		t.mutation(api.affiliate.add, {
			token: 'nope',
			headline: 'H',
			blurb: 'B',
			url: 'https://example.com',
			conceptTags: ['rome']
		})
	).rejects.toThrow(/authorization/i);
	await expect(t.query(api.affiliate.report, { token: '' })).rejects.toThrow(/authorization/i);
});

test('add requires a headline, url, and at least one concept tag', async () => {
	const t = convexTest(schema, modules);
	await expect(
		t.mutation(api.affiliate.add, {
			token: TOKEN,
			headline: '',
			blurb: '',
			url: 'x',
			conceptTags: ['a']
		})
	).rejects.toThrow();
	await expect(
		t.mutation(api.affiliate.add, {
			token: TOKEN,
			headline: 'H',
			blurb: '',
			url: 'u',
			conceptTags: []
		})
	).rejects.toThrow();
});

test('setStatus pause removes an offer from the active feed', async () => {
	const t = convexTest(schema, modules);
	const id = await t.mutation(api.affiliate.add, {
		token: TOKEN,
		headline: 'H',
		blurb: 'B',
		url: 'https://example.com',
		conceptTags: ['rome']
	});
	await t.mutation(api.affiliate.setStatus, { token: TOKEN, offerId: id, status: 'paused' });
	expect(await t.query(api.affiliate.active, {})).toHaveLength(0);
});

test('report joins offers with their tallied impressions/clicks and CTR', async () => {
	const t = convexTest(schema, modules);
	const offerId = await t.mutation(api.affiliate.add, {
		token: TOKEN,
		headline: 'H',
		blurb: 'B',
		url: 'https://example.com',
		conceptTags: ['rome']
	});
	await t.mutation(api.events.log, {
		deviceId: 'd1',
		sessionId: 's1',
		events: [
			{ type: 'sponsored_impression', offerId, ts: 1 },
			{ type: 'sponsored_impression', offerId, ts: 2 },
			{ type: 'sponsored_impression', offerId, ts: 3 },
			{ type: 'sponsored_impression', offerId, ts: 4 },
			{ type: 'sponsored_click', offerId, ts: 5 }
		]
	});

	const report = await t.query(api.affiliate.report, { token: TOKEN });
	expect(report.offers).toHaveLength(1);
	expect(report.offers[0]).toMatchObject({ offerId, impressions: 4, clicks: 1, ctr: 0.25 });
	expect(report.totals).toEqual({ impressions: 4, clicks: 1, ctr: 0.25 });
});

test('events.log accepts sponsored events carrying an offerId', async () => {
	const t = convexTest(schema, modules);
	const offerId = await t.mutation(api.affiliate.add, {
		token: TOKEN,
		headline: 'H',
		blurb: 'B',
		url: 'https://example.com',
		conceptTags: ['rome']
	});
	const res = await t.mutation(api.events.log, {
		deviceId: 'd1',
		sessionId: 's1',
		events: [
			{ type: 'sponsored_impression', offerId, ts: 1 },
			{ type: 'sponsored_click', offerId, ts: 2 }
		]
	});
	expect(res.logged).toBe(2);
});
