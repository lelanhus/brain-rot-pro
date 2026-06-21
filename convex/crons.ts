import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

// Once an hour, turn the top in-demand concepts into auto-published cards
// so the shared library stays ahead of consumption. Bounded by the Workpool's
// concurrency + per-run caps so it can never run away on cost.
const crons = cronJobs();

crons.interval('generate from demand', { hours: 1 }, internal.generationPipeline.processDemand, {
	concepts: 6,
	perConcept: 3
});

export default crons;
