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
		// baseURL is inferred from the (Convex site) request host so the OAuth
		// callback lands on `<deployment>.convex.site/api/auth/callback/google`.
		database: authComponent.adapter(ctx),
		socialProviders: {
			google: {
				clientId: process.env.GOOGLE_CLIENT_ID as string,
				clientSecret: process.env.GOOGLE_CLIENT_SECRET as string
			}
		},
		plugins: [convex({ authConfig })]
	});
