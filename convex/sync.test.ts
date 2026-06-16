import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { isValidCodeFormat, normalizeCode } from './syncLogic';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('a code minted on one device hands its account to another on redeem', async () => {
	const t = convexTest(schema, modules);

	const { code } = await t.mutation(api.sync.createCode, { deviceId: 'device-A' });
	expect(isValidCodeFormat(normalizeCode(code))).toBe(true);

	// Device B can enter it with separators/lowercase, as a human would.
	const adopted = await t.mutation(api.sync.redeem, {
		code: `${code.slice(0, 4)}-${code.slice(4)}`
	});
	expect(adopted.deviceId).toBe('device-A');
});

test('a code is single-use', async () => {
	const t = convexTest(schema, modules);
	const { code } = await t.mutation(api.sync.createCode, { deviceId: 'device-A' });
	await t.mutation(api.sync.redeem, { code });
	await expect(t.mutation(api.sync.redeem, { code })).rejects.toThrow(/already been used/);
});

test('unknown and malformed codes are rejected loudly', async () => {
	const t = convexTest(schema, modules);
	await expect(t.mutation(api.sync.redeem, { code: 'ABCD2345' })).rejects.toThrow(/not found/);
	await expect(t.mutation(api.sync.redeem, { code: 'nope' })).rejects.toThrow(/not valid/);
});

test("minting a new code retires the device's previous one", async () => {
	const t = convexTest(schema, modules);
	const first = await t.mutation(api.sync.createCode, { deviceId: 'device-A' });
	await t.mutation(api.sync.createCode, { deviceId: 'device-A' });
	// The first code no longer resolves.
	await expect(t.mutation(api.sync.redeem, { code: first.code })).rejects.toThrow(/not found/);
});

test('createCode requires a deviceId', async () => {
	const t = convexTest(schema, modules);
	await expect(t.mutation(api.sync.createCode, { deviceId: '' })).rejects.toThrow(
		/deviceId is required/
	);
});
