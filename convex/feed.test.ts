import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('personal feed adapts to the profile: not-interested excluded, liked boosted', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(api.seed.seed, {});
	const deviceId = 'device-personal';

	const page = await t.query(api.cards.feed, { paginationOpts: { numItems: 5, cursor: null } });
	const liked = page.page[0];
	const disliked = page.page[1];

	await t.mutation(api.events.log, {
		deviceId,
		sessionId: 's1',
		events: [
			{ type: 'save', cardId: liked._id, ts: 1 },
			{ type: 'not_interested', cardId: disliked._id, ts: 2 }
		]
	});
	await t.mutation(api.profile.recompute, { deviceId });

	const personal = await t.query(api.feed.personal, { deviceId });
	const ids = personal.map((c) => c._id);

	expect(ids).not.toContain(disliked._id); // not-interested is excluded
	expect(ids).toContain(liked._id);
	// The liked card (all its concepts boosted) should rank in the top half.
	expect(ids.indexOf(liked._id)).toBeLessThan(personal.length / 2);
});

test('personal feed with no profile still returns published cards', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(api.seed.seed, {});
	const personal = await t.query(api.feed.personal, { deviceId: 'nobody' });
	expect(personal.length).toBeGreaterThan(0);
});

test('focusConcept floats matching cards to the top without dropping the rest', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(api.seed.seed, {});

	const baseline = await t.query(api.feed.personal, { deviceId: 'focus-device' });
	// Pick a concept that not every card shares, so focusing is observable.
	const concept = baseline.find((c) => c.conceptTags.length > 0)?.conceptTags[0];
	expect(concept).toBeTruthy();
	const matching = baseline.filter((c) => c.conceptTags.includes(concept!));

	const focused = await t.query(api.feed.personal, {
		deviceId: 'focus-device',
		focusConcept: concept
	});

	// Re-rank, not filter: the full library is still present.
	expect(focused.length).toBe(baseline.length);
	// Every card carrying the concept occupies the top slots.
	const top = focused.slice(0, matching.length);
	expect(top.every((c) => c.conceptTags.includes(concept!))).toBe(true);
});
