import { betterAuth } from 'better-auth';
import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { components } from './_generated/api';
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

export const createAuth = (ctx: GenericCtx<DataModel>) =>
	betterAuth({
		// baseURL MUST be the app's own origin (SITE_URL), not the Convex site
		// host. The SvelteKit handler proxies /api/auth/* to Convex, so the OAuth
		// state/PKCE cookies are set on the app domain during sign-in; building the
		// Google callback on the app domain (`<SITE_URL>/api/auth/callback/google`)
		// keeps the callback same-origin so that cookie is present on return.
		// Inferring from the convex.site request host instead splits the cookie
		// domain and fails the callback with `state_mismatch`.
		baseURL: process.env.SITE_URL as string,
		database: authComponent.adapter(ctx),
		socialProviders: {
			google: {
				clientId: process.env.GOOGLE_CLIENT_ID as string,
				clientSecret: process.env.GOOGLE_CLIENT_SECRET as string
			}
		},
		plugins: [convex({ authConfig })]
	});
