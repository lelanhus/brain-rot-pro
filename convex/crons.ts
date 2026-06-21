import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
import { SUPPLY_BATCH } from './generationPipeline';

// Once an hour, turn the top in-demand concepts into auto-published cards
// so the shared library stays ahead of consumption. Bounded by the Workpool's
// concurrency + per-run caps so it can never run away on cost.
const crons = cronJobs();

crons.interval(
	'generate from demand',
	{ hours: 1 },
	internal.generationPipeline.processDemand,
	SUPPLY_BATCH
);

// Daily: append the most recently available day's top-pageview topics to the
// catalog so it keeps growing without manual backfill runs.
crons.interval('harvest top pageviews', { hours: 24 }, internal.topics.harvestRecent, {});

export default crons;
