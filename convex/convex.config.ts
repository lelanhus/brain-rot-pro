import { defineApp } from 'convex/server';
import workpool from '@convex-dev/workpool/convex.config';
import betterAuth from '@convex-dev/better-auth/convex.config';

// Bounded-concurrency + retrying job queue for demand-driven card generation
// (ingest → generate). One named pool keeps generation work isolated and rate-
// limited so a burst of demand never blows the Wikimedia / AI-Gateway limits.
const app = defineApp();
app.use(workpool, { name: 'generationPool' });
// Better Auth (Google sign-in) — durable cross-device identity.
app.use(betterAuth);

export default app;
