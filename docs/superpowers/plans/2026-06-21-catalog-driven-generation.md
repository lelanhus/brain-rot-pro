# Catalog-Driven Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivot warm-ahead card generation from the breadth-trapped `demand.topConcepts` to the Topic Catalog by pageview rank, via an idempotent `generateForTopic`, and keep `cardCount` accurate.

**Architecture:** A single idempotent `generateForTopic(slug)` reuses the existing `ingestAndGenerate(title)` worker and increments the topic's `cardCount` on a published result. `generateFromCatalog(count)` reads `topics.needingCards` and fans `generateForTopic` jobs through the existing bounded Workpool. The hourly cron, `ensureSupply`, and `run` repoint to it; `demand.ts`/`processDemand` are deleted.

**Tech Stack:** Convex (actions/mutations, `@convex-dev/workpool`, cron), TypeScript, Vitest + `convex-test`. Spec: `docs/superpowers/specs/2026-06-21-catalog-driven-generation-design.md`.

## Global Constraints

- **Supply source = catalog by pageview rank.** `generateFromCatalog` reads `internal.topics.needingCards` (cardCount==0, pageviews desc). 1 card per topic (breadth-first). No demand weighting.
- **`generateForTopic` is idempotent:** skip (return `{ status: 'skipped' }`) when the topic is missing OR `cardCount > 0`, BEFORE any ingest/AI call. Increment `cardCount` ONLY when `ingestAndGenerate` returns `status === 'published'`.
- **`CATALOG_BATCH = 10`** (topics per warm-ahead pass). Workpool stays `maxParallelism: 2`; `ensureSupply` keeps its global 60s throttle (`supplyThrottleOk`).
- **Keep** `ingestAndGenerate`, `pool`, `supplyThrottleOk`, `readSupplyState`, `markSupplyTriggered`. **Delete** `processDemand`, `SUPPLY_BATCH`, the `searchArticleTitles` import, the `internal.demand.topConcepts` call, and `convex/demand.ts`.
- **Do NOT touch `convex/admin.ts` or `src/routes/admin/accounts/[deviceId]/+page.svelte`** — their `topConcepts` is an unrelated symbol (per-device top concepts from `conceptWeights`), not `demand.topConcepts`. `searchArticleTitles` stays defined/exported in `convex/ingest.ts` (unused exports are lint-clean; leave it).
- **Convex conventions:** `internal*` for private functions; explicit `=== null` / `> 0` checks (no truthiness on objects). After adding or removing Convex functions/modules, run `npx convex dev --once` to regenerate `_generated/` (convex-test and tsc resolve `internal`/`api` from the generated files) — this is the project's deploy-to-dev workflow.
- **Tests:** `bun run test:convex` (single file: `npx vitest run --project convex convex/<file>.test.ts`). Before each commit: `bun run check` (0 errors) AND `bunx eslint <changed convex files>` (0 errors).
- **Coverage boundary (state explicitly, don't silently skip):** the orchestration that touches the network/AI/Workpool — `generateForTopic`'s publish path, `generateFromCatalog`'s enqueue, and `ensureSupply`/cron wiring — is NOT unit-tested, consistent with the existing pipeline (only `supplyThrottleOk` was ever unit-tested). It is covered by the pure/DB-only tests below plus a manual `npx convex run generationPipeline:run` after deploy.

---

### Task 1: `incrementCardCount` (cardCount upkeep)

**Files:**

- Modify: `convex/topics.ts` (append one internalMutation)
- Test: `convex/topics.test.ts` (append one test)

**Interfaces:**

- Consumes: `topics` table, `by_slug` index.
- Produces: `internal.topics.incrementCardCount({ slug: string })` → void; `cardCount += 1` on the matching topic, no-op if the slug isn't catalogued.

- [ ] **Step 1: Write the failing test**

Append to `convex/topics.test.ts`:

```ts
test('incrementCardCount bumps an existing topic and no-ops unknown slugs', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Marie Curie',
		pageviews: 500,
		source: 'wikipedia-top'
	});

	await t.mutation(internal.topics.incrementCardCount, { slug: 'marie_curie' });
	await t.mutation(internal.topics.incrementCardCount, { slug: 'marie_curie' });
	expect((await t.query(api.topics.bySlug, { slug: 'marie_curie' }))?.cardCount).toBe(2);

	// Unknown slug: no throw, no row created.
	await t.mutation(internal.topics.incrementCardCount, { slug: 'does_not_exist' });
	expect(await t.query(api.topics.bySlug, { slug: 'does_not_exist' })).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project convex convex/topics.test.ts`
Expected: FAIL — `internal.topics.incrementCardCount` is not a function.

- [ ] **Step 3: Implement**

Append to `convex/topics.ts`:

```ts
/** Increment a topic's published-card count by one. No-op if the slug isn't catalogued. */
export const incrementCardCount = internalMutation({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const topic = await ctx.db
			.query('topics')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.unique();
		if (topic !== null) {
			await ctx.db.patch(topic._id, { cardCount: topic.cardCount + 1, updatedAt: Date.now() });
		}
	}
});
```

(`internalMutation` and `v` are already imported in `topics.ts`.)

- [ ] **Step 4: Regenerate + run test + checks**

Run: `npx convex dev --once` (regenerates `_generated` for the new function)
Run: `npx vitest run --project convex convex/topics.test.ts`
Expected: PASS (cardCount reaches 2; unknown slug stays null).
Run: `bun run check` → 0 errors. Run: `bunx eslint convex/topics.ts` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add convex/topics.ts convex/topics.test.ts convex/_generated
git commit -m "feat(topics): incrementCardCount for catalog cardCount upkeep"
```

---

### Task 2: `publishedDelta` + `generateForTopic`

**Files:**

- Modify: `convex/generateLogic.ts` (append pure helper)
- Test: `convex/generateLogic.test.ts` (append test)
- Modify: `convex/generationPipeline.ts` (append `generateForTopic`)
- Test: `convex/generationPipeline.test.ts` (append skip-path test)

**Interfaces:**

- Consumes: `internal.topics.incrementCardCount` (Task 1), `api.topics.bySlug` (returns `Doc<'topics'> | null`), `internal.generationPipeline.ingestAndGenerate` (existing; `{ title, concept? }` → `{ title, status }` where status ∈ `'filtered'|'exists'|'published'|'validation_failed'|'duplicate'`).
- Produces:
  - `publishedDelta(status: string): number` — `1` iff `status === 'published'`, else `0`.
  - `internal.generationPipeline.generateForTopic({ slug: string })` → `{ status: string }` (the ingestAndGenerate status, or `'skipped'`).

- [ ] **Step 1: Write the failing tests**

Append to `convex/generateLogic.test.ts`. **Add `publishedDelta` to the existing `'./generateLogic'` import line** (don't add a second import from the same module — eslint `import/no-duplicates` will flag it):

```ts
// e.g. change `import { decidePublish } from './generateLogic';`
// to     `import { decidePublish, publishedDelta } from './generateLogic';`

describe('publishedDelta', () => {
	it('is 1 only for a published result', () => {
		expect(publishedDelta('published')).toBe(1);
		expect(publishedDelta('duplicate')).toBe(0);
		expect(publishedDelta('filtered')).toBe(0);
		expect(publishedDelta('validation_failed')).toBe(0);
		expect(publishedDelta('exists')).toBe(0);
		expect(publishedDelta('skipped')).toBe(0);
	});
});
```

(If `generateLogic.test.ts` already imports `describe/it/expect` from `vitest`, reuse that import; otherwise add `import { describe, expect, it } from 'vitest';`.)

Append to `convex/generationPipeline.test.ts` (this file currently only tests `supplyThrottleOk`; add the convex-test harness imports at the top if absent):

```ts
import { convexTest } from 'convex-test';
import { internal, api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('generateForTopic skips covered or unknown topics without generating', async () => {
	const t = convexTest(schema, modules);
	// A topic that already has a card must be skipped (no ingest/AI triggered).
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Black hole',
		pageviews: 900,
		source: 'wikipedia-top'
	});
	await t.mutation(internal.topics.incrementCardCount, { slug: 'black_hole' });

	const covered = await t.action(internal.generationPipeline.generateForTopic, {
		slug: 'black_hole'
	});
	expect(covered.status).toBe('skipped');

	const unknown = await t.action(internal.generationPipeline.generateForTopic, { slug: 'nope' });
	expect(unknown.status).toBe('skipped');

	// cardCount unchanged; no card rows created by the skip path.
	expect((await t.query(api.topics.bySlug, { slug: 'black_hole' }))?.cardCount).toBe(1);
	const cards = await t.run(async (ctx) => ctx.db.query('knowledgeCards').collect());
	expect(cards).toHaveLength(0);
});
```

> Note: this test only exercises the SKIP path (cardCount>0 and missing slug), which returns before any ingest/AI/network call — so it runs fully offline. The publish path is covered by `publishedDelta` + `incrementCardCount` tests plus the manual post-deploy run (per the coverage boundary).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project convex convex/generateLogic.test.ts convex/generationPipeline.test.ts`
Expected: FAIL — `publishedDelta` / `generateForTopic` not defined.

- [ ] **Step 3a: Add the pure helper**

Append to `convex/generateLogic.ts`:

```ts
/**
 * cardCount delta for a generation result: a topic gains a card only when a NEW
 * card is published (not on duplicate/filtered/validation_failed/exists/skipped).
 */
export function publishedDelta(status: string): number {
	return status === 'published' ? 1 : 0;
}
```

- [ ] **Step 3b: Add `generateForTopic`**

Append to `convex/generationPipeline.ts`. Add `publishedDelta` to the existing `generateLogic` import if there is one, otherwise add `import { publishedDelta } from './generateLogic';`. (`api` is already imported from `./_generated/api` in this file; confirm and add it to that import if missing.)

```ts
/**
 * Turn one catalog topic into (at most) one published card. Idempotent: a topic
 * that is missing or already has a card is skipped before any ingest/AI work, so
 * re-enqueuing is safe. On a published result, bump the topic's cardCount.
 */
export const generateForTopic = internalAction({
	args: { slug: v.string() },
	handler: async (ctx, { slug }): Promise<{ status: string }> => {
		const topic = await ctx.runQuery(api.topics.bySlug, { slug });
		if (topic === null || topic.cardCount > 0) return { status: 'skipped' };
		const r = await ctx.runAction(internal.generationPipeline.ingestAndGenerate, {
			title: topic.title
		});
		if (publishedDelta(r.status) > 0) {
			await ctx.runMutation(internal.topics.incrementCardCount, { slug });
		}
		return { status: r.status };
	}
});
```

- [ ] **Step 4: Regenerate + run tests + checks**

Run: `npx convex dev --once`
Run: `npx vitest run --project convex convex/generateLogic.test.ts convex/generationPipeline.test.ts`
Expected: PASS — `publishedDelta` table green; `generateForTopic` skip-path returns `'skipped'`, no cards created, cardCount stays 1.
Run: `bun run check` → 0 errors. Run: `bunx eslint convex/generateLogic.ts convex/generationPipeline.ts` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add convex/generateLogic.ts convex/generateLogic.test.ts convex/generationPipeline.ts convex/generationPipeline.test.ts convex/_generated
git commit -m "feat(generation): generateForTopic (idempotent, catalog-driven) + publishedDelta"
```

---

### Task 3: `generateFromCatalog` + `CATALOG_BATCH`

**Files:**

- Modify: `convex/generationPipeline.ts` (append; additive — nothing rewired yet)

**Interfaces:**

- Consumes: `internal.topics.needingCards({ limit })` (returns `Doc<'topics'>[]`, cardCount==0, pageviews desc), `internal.generationPipeline.generateForTopic` (Task 2), the existing module-level `pool`.
- Produces:
  - `CATALOG_BATCH = 10` (exported const).
  - `internal.generationPipeline.generateFromCatalog({ count?: number })` → `{ enqueued: number }`.

- [ ] **Step 1: Write the failing test**

Append to `convex/generationPipeline.test.ts`:

```ts
test('generateFromCatalog enqueues one job per needing-cards topic, popularity-first', async () => {
	const t = convexTest(schema, modules);
	// Three topics needing cards + one already covered (must be excluded).
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Alpha',
		pageviews: 300,
		source: 'wikipedia-top'
	});
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Beta',
		pageviews: 900,
		source: 'wikipedia-top'
	});
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Gamma',
		pageviews: 600,
		source: 'wikipedia-top'
	});
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Covered',
		pageviews: 999,
		source: 'wikipedia-top'
	});
	await t.mutation(internal.topics.incrementCardCount, { slug: 'covered' });

	const res = await t.action(internal.generationPipeline.generateFromCatalog, { count: 10 });
	expect(res.enqueued).toBe(3); // Alpha, Beta, Gamma — not Covered
});
```

> Note: this asserts the selection count (how many needing-cards topics were picked up), which is the testable contract. The Workpool enqueue itself is integration-level (see coverage boundary). If `pool.enqueueAction` cannot execute under `convex-test` in this environment, the implementer should report it as DONE_WITH_CONCERNS and downgrade this test to assert `generateFromCatalog` selects the right topics via a direct `internal.topics.needingCards` read instead — do not delete the assertion silently.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project convex convex/generationPipeline.test.ts`
Expected: FAIL — `generateFromCatalog` not defined.

- [ ] **Step 3: Implement**

Append to `convex/generationPipeline.ts`:

```ts
/** Topics to turn into cards per warm-ahead pass (bounded by Workpool maxParallelism + ensureSupply cooldown). */
export const CATALOG_BATCH = 10;

/**
 * Warm-ahead supply: take the most-viewed catalog topics that still have no
 * cards and fan a generateForTopic job per topic through the bounded Workpool.
 * Replaces the retired demand-driven processDemand.
 */
export const generateFromCatalog = internalAction({
	args: { count: v.optional(v.number()) },
	handler: async (ctx, { count }): Promise<{ enqueued: number }> => {
		const topics = await ctx.runQuery(internal.topics.needingCards, {
			limit: count ?? CATALOG_BATCH
		});
		for (const topic of topics) {
			await pool.enqueueAction(ctx, internal.generationPipeline.generateForTopic, {
				slug: topic.slug
			});
		}
		return { enqueued: topics.length };
	}
});
```

- [ ] **Step 4: Regenerate + run test + checks**

Run: `npx convex dev --once`
Run: `npx vitest run --project convex convex/generationPipeline.test.ts`
Expected: PASS — `enqueued` is 3 (Covered excluded). (If the Workpool can't run under convex-test, apply the Step-1 note's fallback and report it.)
Run: `bun run check` → 0 errors. Run: `bunx eslint convex/generationPipeline.ts` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add convex/generationPipeline.ts convex/generationPipeline.test.ts convex/_generated
git commit -m "feat(generation): generateFromCatalog warm-ahead off the topic catalog"
```

---

### Task 4: Cutover + retire the demand path

**Files:**

- Modify: `convex/generationPipeline.ts` (rewire `ensureSupply` + `run`; remove `processDemand`, `SUPPLY_BATCH`, `searchArticleTitles` import, `internal.demand` usage, and stale top-comment)
- Modify: `convex/crons.ts` (repoint hourly job to `generateFromCatalog`)
- Delete: `convex/demand.ts`
- Verify: full `bun run test:convex` + eslint, no dangling references

**Interfaces:**

- Consumes: `generateFromCatalog` + `CATALOG_BATCH` (Task 3).
- Produces: `ensureSupply({ deviceId })` and `run({ count? })` now drive `generateFromCatalog`; cron `'generate from catalog'` replaces `'generate from demand'`. `processDemand`/`SUPPLY_BATCH`/`demand.ts` no longer exist.

- [ ] **Step 1: Rewire `ensureSupply` and `run` in `convex/generationPipeline.ts`**

In `ensureSupply`'s handler, replace the supply call:

```ts
// BEFORE:
//   await ctx.runAction(internal.generationPipeline.processDemand, SUPPLY_BATCH);
// AFTER:
await ctx.runAction(internal.generationPipeline.generateFromCatalog, { count: CATALOG_BATCH });
```

Replace `run` entirely:

```ts
/**
 * Manual trigger for demos/ops — same as the cron, runnable from the CLI:
 *   npx convex run generationPipeline:run '{"count":10}'
 */
export const run = action({
	args: { count: v.optional(v.number()) },
	handler: async (ctx, args): Promise<unknown> =>
		ctx.runAction(internal.generationPipeline.generateFromCatalog, args)
});
```

- [ ] **Step 2: Remove the demand path from `convex/generationPipeline.ts`**

- Delete the `export const processDemand = internalAction({ ... })` block in full.
- Delete `export const SUPPLY_BATCH = { concepts: 6, perConcept: 3 } as const;`.
- Delete the import `import { searchArticleTitles } from './ingest';`.
- Update the file's top doc comment so it describes catalog-driven generation (remove the `demand.topConcepts → search Wikipedia per concept` description).
- Keep `ingestAndGenerate`, `pool`, `supplyThrottleOk`, `readSupplyState`, `markSupplyTriggered`, `generateForTopic`, `generateFromCatalog`, `CATALOG_BATCH`, `ensureSupply`, `run`.

- [ ] **Step 3: Repoint the cron in `convex/crons.ts`**

Final `convex/crons.ts`:

```ts
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
```

- [ ] **Step 4: Delete `convex/demand.ts`**

```bash
git rm convex/demand.ts
```

- [ ] **Step 5: Regenerate + verify no dangling references + full suite**

Run: `npx convex dev --once` (regenerates `_generated`, dropping the `demand` module entry)
Run: `grep -rnE "processDemand|SUPPLY_BATCH|internal\.demand|from './demand'|searchArticleTitles" convex --include='*.ts' | grep -v '.test.ts'`
Expected: ONLY `convex/ingest.ts` (the `searchArticleTitles` definition+export) — no other references.
Run: `bun run check` → 0 errors.
Run: `bunx eslint convex/generationPipeline.ts convex/crons.ts` → 0 errors.
Run: `bun run test:convex`
Expected: full suite green (the `supplyThrottleOk` test and all SP1/SP2 tests pass; no test referenced `demand`/`processDemand`).

- [ ] **Step 6: Commit**

```bash
git add convex/generationPipeline.ts convex/crons.ts convex/_generated
git commit -m "feat(generation): cut over warm-ahead to the catalog; retire demand path"
```

---

## Post-implementation (manual, after all tasks merge + deploy)

1. Deploy: `npx convex dev --once` (already happens per-task; re-run on merged main).
2. Smoke-test the cutover: `npx convex run generationPipeline:run '{"count":5}'` — then check a few topics flipped to `cardCount: 1` (`npx convex run topics:topByPageviews '{"limit":20}'`) and that new published cards exist. Generation makes real Wikimedia + AI calls, so allow a minute for the Workpool to drain.
3. The hourly `generate from catalog` cron + `ensureSupply` (client running-low / empty-feed) now grow the library from the catalog automatically.

## Notes on verification

- Unit/DB tests cover: `incrementCardCount` (DB), `publishedDelta` (pure), `generateForTopic` skip-path (DB-only, no network), `generateFromCatalog` selection count, plus the unchanged `supplyThrottleOk`.
- Per the coverage boundary, the live generation path (ingest + AI + Workpool drain) is verified by step 2 above, not by the unit suite — matching how the pre-existing pipeline was tested.
