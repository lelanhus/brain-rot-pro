import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins';
import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import type { GenericActionCtx } from 'convex/server';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import authConfig from './auth.config';

/**
 * Better Auth (Google sign-in). The component stores its own user/session
 * tables; `authComponent.getAuthUser(ctx)` returns the signed-in user document
 * (its `_id` is the durable auth user id used by accounts.linkDevice).
 * Google credentials come from the Convex env (GOOGLE_CLIENT_ID/SECRET); the
 * OAuth callback is served from the Convex site domain (registered in Google).
 */
export const authComponent = createClient<DataModel>(components.betterAuth);

/**
 * Read a required deployment secret, failing loud at the point of use rather
 * than passing `undefined` through to Better Auth (where a missing SITE_URL or
 * Google credential surfaces much later as an opaque `state_mismatch`). See
 * docs/release-gates.md "Harden config validation".
 */
function requireEnv(name: string): string {
	const value = process.env[name];
	if (value === undefined || value === '') {
		throw new Error(
			`Missing required env var ${name}. Set it on the Convex deployment: npx convex env set ${name} "<value>"`
		);
	}
	return value;
}

export const createAuth = (ctx: GenericCtx<DataModel>) =>
	betterAuth({
		// baseURL MUST be the app's own origin (SITE_URL), not the Convex site
		// host. The SvelteKit handler proxies /api/auth/* to Convex, so the OAuth
		// state/PKCE cookies are set on the app domain during sign-in; building the
		// Google callback on the app domain (`<SITE_URL>/api/auth/callback/google`)
		// keeps the callback same-origin so that cookie is present on return.
		// Inferring from the convex.site request host instead splits the cookie
		// domain and fails the callback with `state_mismatch`.
		baseURL: requireEnv('SITE_URL'),
		database: authComponent.adapter(ctx),
		socialProviders: {
			google: {
				clientId: requireEnv('GOOGLE_CLIENT_ID'),
				clientSecret: requireEnv('GOOGLE_CLIENT_SECRET')
			}
		},
		plugins: [
			// Anonymous sessions (B1 / ADR-004): every first visit gets a session so
			// `ctx.auth` yields a stable subject the server can trust as the device
			// principal — closing the forged-deviceId hole. Keep the anon user on
			// link so its data can be merged, not dropped (disableDeleteAnonymousUser).
			anonymous({
				disableDeleteAnonymousUser: true,
				// On Google/Apple sign-in, carry the anonymous device's data
				// (keyed by the anon user id == its deviceId) into the real account
				// via the existing principal/merge logic.
				onLinkAccount: async ({ anonymousUser, newUser }) => {
					await (ctx as GenericActionCtx<DataModel>).runMutation(internal.accounts.applyLink, {
						authUserId: newUser.user.id,
						deviceId: anonymousUser.user.id
					});
				}
			}),
			convex({ authConfig })
		]
	});
