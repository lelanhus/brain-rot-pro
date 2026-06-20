import { defineApp } from 'convex/server';
import workpool from '@convex-dev/workpool/convex.config';

// Bounded-concurrency + retrying job queue for demand-driven card generation
// (ingest → generate). One named pool keeps generation work isolated and rate-
// limited so a burst of demand never blows the Wikimedia / AI-Gateway limits.
const app = defineApp();
app.use(workpool, { name: 'generationPool' });

export default app;
