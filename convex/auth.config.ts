import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config';
import type { AuthConfig } from 'convex/server';

// Better Auth as a Convex auth provider (JWT). Paired with the betterAuth
// component in convex.config.ts and the createAuth() in auth.ts.
export default {
	providers: [getAuthConfigProvider()]
} satisfies AuthConfig;
