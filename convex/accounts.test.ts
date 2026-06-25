/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('applyLink claims the device principal on first sign-in', async () => {
	const t = convexTest(schema, modules);
	const r = await t.mutation(internal.accounts.applyLink, { authUserId: 'u1', deviceId: 'devA' });
	expect(r).toEqual({ principal: 'devA', merged: false });
	const row = await t.run(async (ctx) =>
		ctx.db
			.query('accounts')
			.withIndex('by_authUser', (q) => q.eq('authUserId', 'u1'))
			.unique()
	);
	expect(row?.principal).toBe('devA');
});

test('applyLink merges a new device into the existing principal', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.seed.seed, {}); // gives devB a card to save so the merge has data
	// First sign-in on devA claims it.
	await t.mutation(internal.accounts.applyLink, { authUserId: 'u1', deviceId: 'devA' });
	// devB saves a card, then the same user signs in on devB → merge devB into devA.
	const feed = await t.query(api.cards.feed, { paginationOpts: { numItems: 1, cursor: null } });
	await t
		.withIdentity({ subject: 'devB' })
		.mutation(api.saved.toggle, { deviceId: 'devB', cardId: feed.page[0]._id });
	const r = await t.mutation(internal.accounts.applyLink, { authUserId: 'u1', deviceId: 'devB' });
	expect(r).toEqual({ principal: 'devA', merged: true });
	// devB's save now lives under devA (the principal).
	expect(
		await t.withIdentity({ subject: 'devA' }).query(api.saved.savedIds, { deviceId: 'devA' })
	).toContain(feed.page[0]._id);
});
