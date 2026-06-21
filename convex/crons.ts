import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
import { CATALOG_BATCH } from './generationPipeline';

// Once an hour, turn the most-viewed catalog topics that still lack cards into
// auto-published cards so the shared library grows broadly. Bounded by the
// Workpool's concurrency so it can never run away on cost.
const crons = cronJobs();

crons.interval(
	'generate from catalog',
	{ hours: 1 },
	internal.generationPipeline.generateFromCatalog,
	{ count: CATALOG_BATCH }
);

// Daily: append the most recently available day's top-pageview topics to the catalog.
crons.interval('harvest top pageviews', { hours: 24 }, internal.topics.harvestRecent, {});

export default crons;
