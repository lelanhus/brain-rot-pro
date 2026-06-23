# Offline-ETL Catalog Ingest — Design Spec

**Date:** 2026-06-21 · **Status:** Self-approved (autonomous) · **Direction:** catalog breadth + diversity

## Goal

Replace the flaky in-Convex daily-API backfill with a robust **local ETL** that builds the catalog from Wikimedia **pageview dumps** — every article viewed, not just the daily top-1000 — giving real breadth AND diversity (the long tail of evergreen topics the top-API never surfaces). Recency skew is diluted by **sampling hourly dumps spread across time**, not one contiguous window.

## Why dumps (not the top-API)

The top-1000/day API is recency/popularity-skewed _regardless_ of how many days you harvest, and `fetch failed` from Convex makes it unreliable. The raw hourly pageview dumps list every viewed article with counts — running locally (reliable networking, no Convex action timeouts), sampled across months, yields a large, diverse, evergreen-rich topic set.

## Decisions (YAGNI)

- **Source:** Wikimedia hourly pageview dumps `https://dumps.wikimedia.org/other/pageviews/YYYY/YYYY-MM/pageviews-YYYYMMDD-HH0000.gz` (gz, simple 4-field format `domain_code page_title count total_bytes`). Filter `domain_code === 'en'` (en.wikipedia main namespace), parse title + views.
- **Sampling for diversity:** default a fixed set of file URLs spanning ~12–24 months (e.g. one hour on the 1st of each month). Configurable; more files = more breadth. A handful of ~50–100MB files is enough to surface 100k+ unique articles.
- **Staging + merge (preserve state):** the script emits top-N JSONL → `npx convex import --replace --table topicsStaging` → an in-Convex batched `mergeStagingIntoCatalog` upserts each staging row into `topics` via the **existing `upsertTopic`** (dedupe by slug, accumulate pageviews; existing `cardCount`/`evergreen` are preserved because upsertTopic only patches pageviews on a hit). New slugs insert with `cardCount:0`, `source:'wikipedia-dump'`. **Never** `--replace` the live `topics` table (would wipe cardCount/evergreen).
- **Reuse the quality filter:** the script filters titles with the same `isRealArticleTitle`/`isQualityTopic` rules (imported from `convex/topicsLogic.ts`) so junk never enters.

## Components

- `convex/dumpParse.ts` (pure, no Convex deps — importable by both the script and tests): `parsePageviewLine(line: string): { title: string; views: number } | null` — split the 4 fields, keep `domain_code === 'en'`, reject titles failing `isRealArticleTitle`/`isQualityTopic`, return `{ title (underscored as in dump), views }`; null otherwise.
- `convex/schema.ts`: `topicsStaging` table `{ title: string, slug: string, pageviews: number }` (no indexes needed; merge paginates it).
- `convex/topics.ts`: `mergeStagingIntoCatalog` (internalAction) — paginate `topicsStaging` in batches, `upsertTopic({title, pageviews, source:'wikipedia-dump'})` each; return `{ merged, done }`; resumable (cursor arg) so it can run in passes. Plus `clearStaging` (internalMutation, batched) for cleanup.
- `scripts/build-catalog.mjs` (Node/bun ops script, NOT deployed): given a file-URL list (default sample), stream + gunzip each (`zlib`), parse via `parsePageviewLine`, accumulate views by title in a Map, take top-N (default 200k), normalize title→slug (via `toSlug`), emit JSONL `{title, slug, pageviews}` to stdout/file. Prints run stats. A short README block documents the full flow (`build → convex import → mergeStagingIntoCatalog`).

## Data flow

```
sampled hourly dumps → build-catalog.mjs (stream+gunzip+parsePageviewLine, accumulate, top-N) → catalog.jsonl
  → npx convex import --replace --table topicsStaging catalog.jsonl
  → npx convex run topics:mergeStagingIntoCatalog (passes until done) → upsertTopic into topics (dedupe, preserve cardCount/evergreen)
```

## Testing

- Pure (`dumpParse.test.ts`): `parsePageviewLine` parses a valid `en` line → {title, views}; rejects non-`en` domains, junk titles (`.xyz`, `Main_Page`), malformed lines.
- `convex-test` (`topics.test.ts`): `mergeStagingIntoCatalog` upserts staging rows into topics (new inserts cardCount:0; existing topic keeps its cardCount/evergreen, pageviews accumulate); resumable cursor returns `done:true` when staging exhausted.
- **Ops (controller, post-merge):** run `build-catalog.mjs` on a small real sample (a few files), `convex import` → `mergeStagingIntoCatalog`, confirm the catalog grows substantially and stays junk-free + cardCount/evergreen preserved on pre-existing topics.

## Scope boundary

The script's live dump download isn't unit-tested (ops; the pure parser is tested). No change to harvest/generation/feed. The daily in-Convex `harvestRecent` cron stays (keeps the catalog current day-to-day); the ETL is the bulk/breadth loader.

## Risks

- Large downloads: mitigated by sampling a handful of files (not a full month). The script streams (constant memory) and is restartable per file.
- Dump format drift: the implementer inspects a real sample line before finalizing `parsePageviewLine`; the format is stable and simple.
- Merge volume: batched + resumable; 100–200k upserts run in passes.
- pageview accumulation sums across sampled hours (ranking-robust, per the SP1 catalog risk note).
