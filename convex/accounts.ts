import { internalMutation, mutation } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { decideLink } from './accountsLogic';
import { mergeAccounts } from './accountMerge';
import { authComponent } from './auth'; // exported by the Better Auth scaffold (Task 1)

/**
 * Bind an auth user to a principal and (if needed) merge a device's anonymous
 * data into it. Internal + authUserId-as-arg so it's unit-testable without the
 * auth component (the auth read happens only in `linkDevice`).
 */
export const applyLink = internalMutation({
	args: { authUserId: v.string(), deviceId: v.string() },
	returns: v.object({ principal: v.string(), merged: v.boolean() }),
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('accounts')
			.withIndex('by_authUser', (q) => q.eq('authUserId', args.authUserId))
			.unique();
		const decision = decideLink(existing?.principal ?? null, args.deviceId);
		if (decision.action === 'claim') {
			await ctx.db.insert('accounts', {
				authUserId: args.authUserId,
				principal: decision.principal,
				createdAt: Date.now()
			});
			return { principal: decision.principal, merged: false };
		}
		if (decision.action === 'merge') {
			await mergeAccounts(ctx, args.deviceId, decision.principal);
			return { principal: decision.principal, merged: true };
		}
		return { principal: decision.principal, merged: false };
	}
});

/**
 * Called by the client right after Google sign-in. Resolves the auth user and
 * binds/merges the current device. Returns the principal to adopt client-side.
 */
export const linkDevice = mutation({
	args: { deviceId: v.string() },
	returns: v.object({ principal: v.string(), merged: v.boolean() }),
	handler: async (ctx, args): Promise<{ principal: string; merged: boolean }> => {
		if (args.deviceId.length === 0) throw new Error('linkDevice: deviceId is required');
		const user = await authComponent.getAuthUser(ctx);
		if (user === null || user === undefined) throw new Error('linkDevice: not authenticated');
		// PIN the exact id field from the Better Auth docs (`user._id` or `user.userId`).
		const authUserId = user._id;
		return await ctx.runMutation(internal.accounts.applyLink, {
			authUserId,
			deviceId: args.deviceId
		});
	}
});
