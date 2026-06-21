# Catalog-Driven Generation — Design Spec

**Date:** 2026-06-21
**Status:** Approved (brainstorming) — ready for implementation plan
**Sub-project:** 2 of 6 in the "Topics & Interests" system

## Goal

Make card generation draw from the Topic Catalog (sub-project 1) by pageview
rank instead of from already-seen user concepts. This fixes the breadth gap at
its root: warm-ahead generation walks `topics.needingCards` (topics with no
cards yet, most-viewed first) and turns each into a published card, so the
library grows broadly on its own. Also exposes a single, idempotent
`generateForTopic` capability that on-demand callers (sub-project 4 search) will
reuse, and keeps the catalog's `cardCount` accurate going forward.

## Context

Builds directly on sub-project 1 (Topic Catalog), which shipped the `topics`
table, `needingCards` (cardCount==0, pageviews desc), `bySlug`, and the
in-Convex harvest. The confirmed root cause of the breadth gap (see the
`feed-fetch-more-cards-on-demand` project note): the old supply path derived
generation targets from `demand.topConcepts` = `userProfiles.conceptWeights`,
which only ever contains concepts users already saw — so generation could
deepen existing topics but never introduce new ones. This sub-project replaces
that path with catalog-driven generation.

Larger-system build order: 1. Topic Catalog ✅ · **2. Catalog-driven
generation ← this spec** · 3. Interests + blended feed · 4. Topic search · 5.
Onboarding · 6. Auto-discovery.

**Decision (this spec):** warm-ahead picks topics purely by catalog pageview
rank (top-pageview ≈ broadly wanted, so it serves demand implicitly).
Demand-weighted generation is retired now; demand-aware prioritization, if ever
wanted, belongs to the interests sub-projects (3/6).

## Architecture

A single idempotent unit, `generateForTopic(slug)`, turns one catalog topic
into (at most) one published card by reusing the existing
`ingestAndGenerate(title)` worker (ingest the Wikipedia article → AI-generate →
auto-publish via `decidePublish`), then increments that topic's `cardCount` on a
published result. Warm-ahead (`generateFromCatalog`) reads the catalog's
`needingCards` priority queue and fans `generateForTopic` jobs through the
existing bounded Workpool (`maxParallelism: 2`, retrying). The hourly cron, the
throttled client trigger `ensureSupply`, and the manual `run` op all repoint
from the retired demand path to `generateFromCatalog`. The demand-derived
breadth path (`demand.ts`, `processDemand`, concept→`searchArticleTitles`) is
deleted.

## Components

All in `convex/`:

- **`generationPipeline.ts`** (modify):
  - `generateForTopic` (internalAction) — args `{ slug: string }`. Look up the
    topic via `internal.topics.bySlug` (using the slug directly against the DB
    inside an internal query helper — see note). If not found or `cardCount > 0`,
    return `{ status: 'skipped' }` (idempotent: never regenerates a covered
    topic). Otherwise call `ingestAndGenerate({ title: topic.title })`; if its
    status is `'published'`, call `internal.topics.incrementCardCount({ slug })`.
    Return `{ status }` (one of ingestAndGenerate's statuses, or `'skipped'`).
  - `generateFromCatalog` (internalAction) — args `{ count?: number }` (default
    `CATALOG_BATCH`). Read `internal.topics.needingCards({ limit: count })`;
    for each, `pool.enqueueAction(ctx, internal.generationPipeline.generateForTopic, { slug })`.
    Return `{ enqueued: number }`. Replaces `processDemand`.
  - `CATALOG_BATCH` — `10` (topics per warm-ahead pass). Replaces `SUPPLY_BATCH`.
    Cost stays bounded by the Workpool `maxParallelism: 2` + the existing 60s
    `ensureSupply` cooldown.
  - `ensureSupply` (modify) — unchanged throttle/cooldown logic; on trigger,
    call `generateFromCatalog({ count: CATALOG_BATCH })` instead of
    `processDemand`. Keep the `deviceId` arg (call-signature stability) and the
    `{ triggered }` return.
  - `run` (modify) — ops/manual wrapper now delegates to `generateFromCatalog`.
    Args become `{ count?: number }`.
  - `ingestAndGenerate` (keep) — the per-article worker, unchanged. It is now
    called only by `generateForTopic`. Drop its now-unused `concept` arg only if
    nothing else passes it (verify during implementation).
  - Delete `processDemand` and the `import { searchArticleTitles } from './ingest'`
    if it becomes unused.

- **`topics.ts`** (modify): add
  - `incrementCardCount` (internalMutation) — args `{ slug: string }`. Look up
    topic by `by_slug`; if found, `cardCount += 1`, bump `updatedAt`. No-op if
    the slug isn't catalogued (defensive).

- **`demand.ts`** (delete) — `topConcepts` is the breadth trap; nothing should
  reference it after this change.

- **`crons.ts`** (modify): rename/repoint the hourly job from
  `'generate from demand' → internal.generationPipeline.processDemand` to
  `'generate from catalog' → internal.generationPipeline.generateFromCatalog`
  with `{ count: CATALOG_BATCH }` (import `CATALOG_BATCH` instead of
  `SUPPLY_BATCH`).

Note on `generateForTopic` topic lookup: `topics.bySlug` is a public `query`
returning `Doc<'topics'> | null` — `generateForTopic` reads it via
`ctx.runQuery(api.topics.bySlug, { slug })` (or an internal equivalent). Use
whichever keeps the call internal; if a public-query call from an internal
action is awkward, add a thin `internal` alias in `topics.ts`. Decide in the
plan; do not duplicate the lookup logic.

## Data flow

```
cron 'generate from catalog' ┐
ensureSupply (client/empty)  ├─▶ generateFromCatalog(count)
run (ops)                    ┘        │
                                      ▼
                         topics.needingCards (cardCount==0, pageviews desc)
                                      │  (per topic, Workpool ×2)
                                      ▼
                         generateForTopic(slug)
                           ├─ cardCount>0 / missing → skipped
                           └─ ingestAndGenerate(title)
                                └─ status==='published' → incrementCardCount(slug)
```

## Error handling

- `generateForTopic` inherits the Workpool's retry behavior (transient ingest /
  AI / Wikimedia failures ride out via the existing
  `defaultRetryBehavior`). A topic that repeatedly fails ingest (e.g. filtered,
  no free image) simply never gets a card and stays in `needingCards` — the next
  pass moves on to other topics (acceptable; it self-limits).
- Idempotency: the `cardCount > 0` guard makes re-enqueueing a topic safe; the
  `ingestAndGenerate` 'exists' path (article already carded) is also safe (no
  increment unless a NEW publish happens). A topic carded before its cardCount
  was set is reconciled by SP1's `backfillCardCounts` (already run) and, going
  forward, by `incrementCardCount` on publish.
- `ensureSupply` keeps its global 60s throttle; concurrent triggers are bounded
  by the Workpool, so a rare double-trigger is acceptable.
- Convex conventions: `internal*` for private fns; explicit `=== null` /
  `> 0` checks; no truthiness on objects.

## Testing

- `generateForTopic`: skips when `cardCount > 0`; skips when slug not catalogued;
  on a stubbed-published `ingestAndGenerate`, increments cardCount exactly once;
  on stubbed 'duplicate'/'filtered'/'validation_failed', does NOT increment.
- `incrementCardCount`: increments an existing topic; no-op for an unknown slug.
- `generateFromCatalog`: reads `needingCards` in pageview order and enqueues one
  job per topic; respects `count`.
- `ensureSupply`: still throttled (existing `supplyThrottleOk` test stays); on
  trigger it invokes the catalog path (assert via the enqueue side-effect / a
  stubbed `generateFromCatalog`).
- Cron registration: `'generate from catalog'` points at `generateFromCatalog`;
  the old `'generate from demand'` job is gone.
- Regression: full `bun run test:convex` green after `demand.ts` removal (no
  dangling references).

## Scope boundary

- No UI, no feed-ranking changes, no interests model (SP3).
- The user-facing "search a topic → generate it" trigger is SP4; SP2 only
  exposes `generateForTopic` for it to call.
- 1 card per topic (breadth-first). Multiple-cards-per-topic depth is out of
  scope.

## Risks / open considerations

- **Generation quality at breadth.** Generating across many top-pageview topics
  surfaces more varied articles; some will `validation_failed` or be `filtered`
  (no free image). That's expected and bounded — failures just don't produce
  cards. Monitor the published-vs-attempted ratio after rollout.
- **Cron cadence vs catalog size.** Hourly × `CATALOG_BATCH(10)` ≈ 240
  topics/day of warm-ahead, plus `ensureSupply` bursts when users run low. With
  a ~100–200k catalog this is steady, not exhaustive; `ensureSupply` covers
  real-time demand spikes. Tune `CATALOG_BATCH`/cadence later if needed (no
  rework).
- **`demand.ts` deletion.** Verified references (2026-06-21 grep): only
  `generationPipeline.ts` (import + `processDemand` + `SUPPLY_BATCH` + the
  `internal.demand.topConcepts` call + `searchArticleTitles` import) and
  `crons.ts` (`SUPPLY_BATCH` + `processDemand`) reference the retire-targets.
  **Do NOT touch `admin.ts` or `src/routes/admin/accounts/[deviceId]`** — their
  `topConcepts` is an unrelated symbol (per-device top concepts computed from
  `conceptWeights` for the admin view), not `demand.topConcepts`.
  `searchArticleTitles` is defined+exported in `ingest.ts`; after removing its
  import from `generationPipeline.ts` it has no importers but stays exported in
  `ingest.ts` (unused exports are lint-clean; leave it — out of scope to remove).
  Repoint `crons.ts` and `run` in the same change so the build never breaks.
