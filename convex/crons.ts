import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

// Keep the published library growing toward what people actually want: a few
// times a day, turn the top in-demand concepts into review-queued cards. The
// human publish gate (ADR / review §3.2) is unchanged — this only fills the
// queue. Bounded by the Workpool's concurrency and the per-run concept/title
// caps so it can never run away on cost.
const crons = cronJobs();

crons.interval('generate from demand', { hours: 6 }, internal.generationPipeline.processDemand, {
	concepts: 4,
	perConcept: 2
});

export default crons;
