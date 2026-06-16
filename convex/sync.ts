import { mutation } from './_generated/server';
import { v } from 'convex/values';
import {
	CODE_TTL_MS,
	generateCode,
	isExpired,
	isValidCodeFormat,
	normalizeCode
} from './syncLogic';

/**
 * Cross-device account sync (ADR-004). `createCode` mints a short-lived code for
 * the calling device; `redeem` hands the source device's id to a new device so
 * it adopts the same anonymous account (saves / streak / profile all key on that
 * id). Codes are single-use and expire fast — they grant account access.
 */

/** Mint a fresh sync code for this device, retiring any prior unredeemed one. */
export const createCode = mutation({
	args: { deviceId: v.string() },
	returns: v.object({ code: v.string(), expiresAt: v.number() }),
	handler: async (ctx, args) => {
		if (args.deviceId.length === 0) throw new Error('createCode: deviceId is required');

		// Retire this device's earlier live codes so only the newest works.
		const prior = await ctx.db
			.query('syncCodes')
			.filter((q) => q.eq(q.field('deviceId'), args.deviceId))
			.collect();
		await Promise.all(prior.filter((p) => !p.redeemedAt).map((p) => ctx.db.delete(p._id)));

		// Generate a code that isn't currently taken (collisions are astronomically
		// rare, but a live duplicate would be ambiguous, so guard against it).
		let code = generateCode();
		for (let i = 0; i < 5; i++) {
			const clash = await ctx.db
				.query('syncCodes')
				.withIndex('by_code', (q) => q.eq('code', code))
				.unique();
			if (!clash) break;
			code = generateCode();
		}

		const now = Date.now();
		const expiresAt = now + CODE_TTL_MS;
		await ctx.db.insert('syncCodes', { code, deviceId: args.deviceId, createdAt: now, expiresAt });
		return { code, expiresAt };
	}
});

/**
 * Redeem a code on a new device: returns the source `deviceId` to adopt. Throws
 * (loud, never silent) on an unknown / expired / already-used code. Single-use.
 */
export const redeem = mutation({
	args: { code: v.string() },
	returns: v.object({ deviceId: v.string() }),
	handler: async (ctx, args) => {
		const code = normalizeCode(args.code);
		if (!isValidCodeFormat(code)) throw new Error('That code is not valid.');

		const row = await ctx.db
			.query('syncCodes')
			.withIndex('by_code', (q) => q.eq('code', code))
			.unique();
		if (!row) throw new Error('That code was not found.');
		if (row.redeemedAt) throw new Error('That code has already been used.');
		if (isExpired(row.expiresAt, Date.now())) throw new Error('That code has expired.');

		await ctx.db.patch(row._id, { redeemedAt: Date.now() });
		return { deviceId: row.deviceId };
	}
});
