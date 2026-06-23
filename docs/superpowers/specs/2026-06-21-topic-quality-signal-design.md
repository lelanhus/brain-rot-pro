# Topic Quality Signal (Evergreen) — Design Spec

**Date:** 2026-06-21 · **Status:** Self-approved (autonomous) · **Direction:** card & topic quality

## Goal

Make the catalog's quality match the library's. The published library is already evergreen-gated (ingest runs `wikidataLogic.classifyTopic`/`decideArticleStatus`, so sports/crime/film articles `filtered_out` → no card). But the **catalog** isn't classified, so non-evergreen topics surface in onboarding suggestions, discovery candidates, and the `needingCards` generation queue (wasting passes). Add an `evergreen` verdict to topics and filter those three surfaces on it. Reuse the existing classifier — no brittle title hacks.

## Decisions (YAGNI)

- **`evergreen: v.optional(v.boolean())`** on `topics` (undefined = unclassified, true = good, false = junk). Optional → no migration; no new index — the three surfaces filter `evergreen !== false` in-query (`.filter(q => q.neq(q.field('evergreen'), false))`), cheap at current scale (suggestions ~18, needingCards ~10, discovery ~12). Index is a future lever if the catalog gets huge.
- **Populated two ways:**
  - **Reactive (free):** `generateForTopic` already runs the Wikidata classifier via `ingestAndGenerate`. Record the verdict: `evergreen = (status !== 'filtered')` (pure `evergreenFromStatus`). `'filtered'` = ingest's evergreen-reject; `published`/`exists`/`validation_failed`/`duplicate` all mean the topic itself is fine. The skip path (cardCount>0 / missing) doesn't touch it.
  - **Proactive (bounded job):** `classifyTopTopics({limit})` classifies the most-popular _unclassified_ topics directly via Wikidata, reusing an extracted `ingest.classifyTitle` (fetch categories + Wikidata claims → `classifyTopic` + `decideArticleStatus`). Run in passes like the backfill so suggestions clean up immediately, not only after generation attempts.
- **Filter sites:** onboarding suggestions + discovery candidates + `needingCards`. **Search stays unfiltered** (intentional lookups should find anything).

## Components

- `convex/schema.ts`: `topics.evergreen: v.optional(v.boolean())`.
- `convex/topicsLogic.ts`: pure `evergreenFromStatus(status: string): boolean` = `status !== 'filtered'`.
- `convex/topics.ts`:
  - `setEvergreen` (internalMutation) — `{slug, evergreen}` → patch the topic.
  - `topByPageviews` (modify) — add `.filter(q => q.neq(q.field('evergreen'), false))`.
  - `needingCards` (modify) — add the same filter (skips known-junk + stops re-attempting filtered topics).
  - `classifyTopTopics` (action) — top-by-pageviews where `evergreen` is undefined, for each `ctx.runAction(internal.ingest.classifyTitle, {title})` → `setEvergreen`. Bounded `limit` per run.
- `convex/generationPipeline.ts` (`generateForTopic`): after a non-skip `ingestAndGenerate`, `setEvergreen(slug, evergreenFromStatus(status))`.
- `convex/discovery.ts` (`candidatesBySlugs`): drop rows with `evergreen === false`.
- `convex/ingest.ts`: extract/export `classifyTitle` (internalAction `{title}` → `{evergreen: boolean}`) reusing the existing article+Wikidata fetch + `classifyTopic`/`decideArticleStatus` (no card generation, no storage).

## Data flow

```
generateForTopic → ingestAndGenerate(status) → setEvergreen(slug, status!=='filtered')   [reactive]
classifyTopTopics(limit) → unclassified top topics → ingest.classifyTitle → setEvergreen  [proactive]
suggestions / needingCards / discovery candidates → filter evergreen !== false
```

## Testing

- Pure (`topicsLogic.test.ts`): `evergreenFromStatus` — false only for 'filtered'; true for published/exists/validation_failed/duplicate.
- `convex-test` (`topics.test.ts`): `setEvergreen` patches; `topByPageviews`/`needingCards` exclude `evergreen===false`, include true + undefined.
- `convex-test`: `candidatesBySlugs` drops `evergreen===false`.
- `convex-test` (fetch-stubbed): `ingest.classifyTitle` returns evergreen verdict from stubbed Wikidata/category data; `classifyTopTopics` sets evergreen on unclassified top topics (coverage boundary for the live Wikidata call).

## Scope boundary

No new index/migration; no UI changes (suggestions just get cleaner); search unfiltered; the proactive job is bounded/ops-run (optional cron later). No re-classification of already-classified topics.

## Risks

- In-query `neq` filter scans past junk-at-top; fine to ~100k, add an index if needed (documented).
- Wikidata classification is imperfect (the existing taxonomy); reuses the same allow/block lists the library already trusts — consistent, not new risk.
- Reactive verdict lags (topic must be generation-attempted once); the proactive job covers the suggestion-relevant top set.
