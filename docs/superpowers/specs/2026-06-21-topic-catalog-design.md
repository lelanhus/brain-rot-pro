# Topic Catalog — Design Spec

**Date:** 2026-06-21
**Status:** Approved (brainstorming) — ready for implementation plan
**Sub-project:** 1 of 6 in the "Topics & Interests" system (see Context below)

## Goal

Build a searchable, ranked catalog of ~100–200k Wikipedia topics inside Convex,
harvested from Wikimedia top-pageview data and kept fresh automatically. The
catalog is the breadth backbone the rest of the Topics & Interests system sits
on: it backs topic search, curation suggestions, and — critically — gives the
card-generation pipeline a deep, popularity-ranked queue to draw from, fixing
the breadth gap where generation could only ever re-surface already-seen
concepts.

This sub-project ships the catalog, its harvest pipeline, and read queries
**only**. It does not change the feed, card generation, or add UI.

## Context: the larger system (background, not in scope here)

The user wants three interlocking capabilities — curate topics for the user,
auto-discover user interests, and let users search topics — backed by a vast
topic space available *before* the first production user. Agreed product
decisions that frame this and future sub-projects:

- **Catalog topics, cards on demand.** Pre-load a large topic catalog cheaply;
  generate cards lazily when a topic is first explored, plus warm-ahead for
  popular topics. ("1M" was directional; ~100–200k top-pageview topics is the
  reasonable target.)
- **Source:** top English Wikipedia articles by pageviews (rank doubles as
  generation priority). Wikipedia is already the app's grounding source.
- **One blended "For You" feed** whose ranking blends a user's interests
  (explicit + discovered + implicit), plus the ability to drill into a single
  topic.
- **Anonymous-first preserved.** No hard auth wall on content. An optional
  onboarding interest-picker captures interests and is where sign-in is
  prompted ("save across devices"); an account is required only to persist/sync
  interests, not to view content.

**Build order (each its own spec → plan → build):**
1. **Topic Catalog** ← *this spec*
2. Catalog-driven generation (rewire warm-ahead + `ensureSupply` to draw from
   the catalog by pageview rank; lazy generation on demand) — the breadth fix.
3. Interests model + blended feed.
4. Topic search (typeahead over the catalog).
5. Onboarding interest-picker + sign-in-to-save prompt.
6. Auto-discovery (broaden interests to related topics).

## Architecture

A new `topics` table holds one row per Wikipedia article we've seen in
top-pageview data, deduped by a normalized slug, with an accumulated pageview
count as the popularity/priority signal and a denormalized `cardCount` so
downstream generation can cheaply find popular topics that still lack cards. A
full-text search index on the title backs topic search. Harvesting is entirely
in-Convex: a bounded, resumable backfill walks historical daily top-1000 lists
to build the catalog, and a daily cron appends new days going forward. No
external tooling or bulk dumps.

### Data model — `topics` table

```ts
topics: defineTable({
  title: v.string(),        // Wikipedia article title as returned by the API, e.g. "Marie_Curie"
  slug: v.string(),         // normalized dedupe/link key, e.g. "marie_curie"
  pageviews: v.number(),    // cumulative views across harvested days (popularity signal)
  cardCount: v.number(),    // # published cards for this topic (0 = needs generation)
  source: v.string(),       // 'wikipedia-top' (leaves room for future sources)
  updatedAt: v.number(),
})
  .index('by_slug', ['slug'])
  .index('by_pageviews', ['pageviews'])
  .index('by_cardCount_pageviews', ['cardCount', 'pageviews'])
  .searchIndex('search_title', { searchField: 'title' }),
```

Notes:
- **No stored `rank`** — popularity order is read from the `by_pageviews` index
  (descending), avoiding a re-rank of the whole table on every harvest.
- **`cardCount` denormalized** so `needingCards` (generation priority) is a cheap
  indexed range query (`cardCount == 0`, ordered by pageviews desc) rather than a
  per-topic card scan.
- **Category / embedding columns are deferred** to the auto-discovery
  sub-project (6), where they are actually consumed. 1M topic embeddings is a
  real cost; we do not pay it until discovery needs it.

### Harvest state — `catalogState` (singleton row)

Tracks backfill progress so a bounded action can resume across runs:

```ts
catalogState: defineTable({
  key: v.string(),              // 'global'
  lastHarvestedDate: v.string(),// ISO 'YYYY-MM-DD' of the most recent day harvested by the daily cron
  backfillCursorDate: v.optional(v.string()), // ISO date the historical backfill has reached (walks backward)
  updatedAt: v.number(),
}).index('by_key', ['key']),
```

## Components

All in `convex/`, split by responsibility:

- **`topicsLogic.ts`** (pure, no Convex deps — unit-testable):
  - `isRealArticleTitle(title: string): boolean` — filters non-article noise:
    `Main_Page`, `Special:*`, `Wikipedia:*`, `Portal:*`, `Help:*`, `Template:*`,
    `Category:*`, `File:*`, titles starting `List_of_`, disambiguation
    (`(disambiguation)` suffix), and pure date/number pages.
  - `toSlug(title: string): string` — normalize to a dedupe key: lowercase,
    collapse spaces to underscores, trim, strip leading/trailing underscores.
  - `mergePageviews(existing: number, incoming: number): number` — cumulative
    sum (sustained popularity across days is a feature, not double-counting).

- **`topics.ts`** (Convex functions):
  - `upsertTopic` (internalMutation) — args `{ title, pageviews, source }`;
    dedupe by slug via `by_slug`; on hit, `mergePageviews` + bump `updatedAt`;
    on miss, insert with `cardCount: 0`.
  - `harvestTopDay` (internalAction) — args `{ date: 'YYYY-MM-DD' }`; fetch the
    Wikimedia top-1000 for that day (reuse `PAGEVIEWS_API` + `USER_AGENT` from
    `ingest.ts`), filter via `isRealArticleTitle`, `upsertTopic` each survivor.
    Returns `{ fetched, kept }`.
  - `backfillCatalog` (internalAction) — args `{ days?: number }` (default ~30);
    reads `catalogState.backfillCursorDate` (defaults to yesterday), walks
    **backward** `days` days calling `harvestTopDay`, advancing the cursor after
    each successful day, politely sequential. Bounded per run to stay within
    action limits; re-invoke (or schedule) to continue. Idempotent: re-harvesting
    a day just re-accumulates the same slugs (acceptable; see Risks).
  - `topByPageviews` (query) — args `{ limit }`; top topics by pageviews desc
    (curation suggestions + priority).
  - `search` (query) — args `{ query, limit }`; `search_title` index → matches.
  - `needingCards` (internalQuery) — args `{ limit }`; `by_cardCount_pageviews`
    where `cardCount == 0`, ordered pageviews desc.
  - `bySlug` (query) — args `{ slug }`; single lookup.
  - `backfillCardCounts` (internalAction, one-time) — map existing published
    `knowledgeCards` to topics by `toSlug(card.source.articleTitle)` (the
    `sourceValidator` field in `schema.ts`) and set initial `cardCount`. Skips
    cards whose source slug isn't in the catalog. Going
    forward, `cardCount` upkeep is owned by sub-project 2 (generation), not here.

- **`crons.ts`** (existing) — add a daily `harvestTopDay(yesterday)` job and
  advance `lastHarvestedDate`.

## Data flow

```
Wikimedia top-1000/day  ──(harvestTopDay)──▶ filter(isRealArticleTitle)
        ▲                                          │
        │                                          ▼
  backfillCatalog (walks back, bounded)      upsertTopic (dedupe by slug, sum pageviews)
  daily cron (appends new days)                     │
                                                    ▼
                                              topics table  ──▶ search / topByPageviews / needingCards
```

## Error handling

- **API failure for a day:** `harvestTopDay` returns/throws; `backfillCatalog`
  logs and skips that day **without advancing the cursor past unprocessed days**
  in a way that silently drops them — on failure it stops the run so the next
  run retries from the same cursor. The daily cron tolerates a missing day (next
  day's run proceeds; a gap is acceptable — pageviews are cumulative and a single
  missed day barely matters).
- **Politeness / rate limits:** sequential requests with the existing
  `USER_AGENT`; bounded days-per-run keeps call volume modest. No parallel fan-out.
- **Malformed titles:** `isRealArticleTitle` is the gate; anything ambiguous is
  dropped (fail-closed toward a cleaner catalog).
- **Strict-boolean / Convex conventions:** follow project lint rules (explicit
  `=== undefined` checks, `internal*` for private fns, `.convex.site` not used
  here since no HTTP actions).

## Testing

- **Pure unit (`topicsLogic.test.ts`):** `isRealArticleTitle` accepts real
  articles and rejects each noise class; `toSlug` normalizes variants to one key
  (`"Marie Curie"`, `"Marie_Curie"` → `marie_curie`); `mergePageviews` sums.
- **`convex-test` (`topics.test.ts`):** `upsertTopic` inserts new + accumulates
  on duplicate slug; `needingCards` returns only `cardCount == 0`, most-popular
  first; `search` returns title matches; `topByPageviews` orders correctly;
  `backfillCardCounts` sets counts from seeded cards and skips uncatalogued
  sources.

## Scope boundary (what this sub-project does NOT do)

- No change to the feed, ranking, or `feed.unseen`.
- No change to card generation (sub-project 2 rewires generation to consume
  `needingCards` / `topByPageviews`).
- No UI (search UI is sub-project 4; onboarding is 5).
- No interests model (sub-project 3).
- No topic embeddings / category enrichment (sub-project 6).

Independently verifiable: row count grows as backfill runs; `search` returns
expected titles; `needingCards` is ordered; re-running a harvest day is
idempotent w.r.t. row identity.

## Risks / open considerations

- **Cumulative pageviews double-count across re-harvested days.** If the same
  day is harvested twice (e.g., a manual re-run), that day's views are added
  again. Acceptable: pageviews is a *relative* popularity signal, not an exact
  metric, and ranking is robust to it. If it ever matters, dedupe by recording
  harvested dates — deferred (YAGNI).
- **Coverage ceiling.** Daily top-1000 over ~1–2 years yields ~100–200k unique
  topics; the obscure long tail toward 1M is out of reach via this API. If that
  tail is ever wanted, add the offline-ETL path (Wikimedia monthly
  `pageview-complete` dump → `npx convex import`) as an enhancement — no rework
  of this schema.
- **Backfill duration.** ~365–730 sequential API calls. The bounded
  resumable design spreads this across runs/days; the catalog is usable
  (and grows) from the first run.
```
