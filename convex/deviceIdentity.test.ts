/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

/**
 * B1 security contract: device-scoped functions trust the SESSION, not the
 * `deviceId` arg. `requireDevice` lets a caller act only as the subject of its
 * own Better Auth session. These run against `saved.toggle` as a representative
 * device-scoped mutation; the same guard wraps every public device-scoped fn.
 */

async function aCardId(t: ReturnType<typeof convexTest>) {
	await t.mutation(internal.seed.seed, {});
	const cards = await t.run(async (ctx) => ctx.db.query('knowledgeCards').take(1));
	return cards[0]!._id;
}

test('a caller may act as its own session subject', async () => {
	const t = convexTest(schema, modules);
	const cardId = await aCardId(t);
	const me = t.withIdentity({ subject: 'device-me' });

	expect(await me.mutation(api.saved.toggle, { deviceId: 'device-me', cardId })).toEqual({
		saved: true
	});
	expect(await me.query(api.saved.savedIds, { deviceId: 'device-me' })).toContain(cardId);
});

test('an unauthenticated caller is rejected (no session)', async () => {
	const t = convexTest(schema, modules);
	const cardId = await aCardId(t);
	await expect(t.mutation(api.saved.toggle, { deviceId: 'device-me', cardId })).rejects.toThrow(
		/session is required/i
	);
});

test('a caller cannot act as another device — forgery is refused', async () => {
	const t = convexTest(schema, modules);
	const cardId = await aCardId(t);
	const attacker = t.withIdentity({ subject: 'attacker' });

	// Forging the victim's deviceId while holding the attacker's session fails…
	await expect(attacker.mutation(api.saved.toggle, { deviceId: 'victim', cardId })).rejects.toThrow(
		/does not match/i
	);
	// …and cannot read the victim's saves either.
	await expect(attacker.query(api.saved.savedIds, { deviceId: 'victim' })).rejects.toThrow(
		/does not match/i
	);
});
