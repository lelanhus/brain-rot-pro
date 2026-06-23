# Infinite unseen feed — design

**Date:** 2026-06-20
**Status:** Approved (pending spec review)

## Requirements (hard)

1. **A user never sees the same card twice** — ever (durable, for the life of the device/account).
2. **A user can see thousands of cards per day** — the feed must scale to that volume per user without repeating.

## Problem (what breaks today)

- `userProfiles.seen` is a single `v.array(v.id('knowledgeCards'))` in one document. At thousands/day it grows unbounded in one doc (Convex ~1 MB/doc limit, slow array ops). **Hard blocker for "never twice."**
- `profileLogic.scoreCard` only subtracts a `SEEN_PENALTY` — seen cards are _down-ranked, not excluded_, so repeats happen.
- `feed.personal` `.collect()`s every published card and scores in JS (fine at 37, breaks at thousands).
- Generation is a 6-hourly cron of ~8 cards — orders of magnitude below thousands/day.

## Decisions (from brainstorming)

- **Shared growing library:** one shared pool of Wikipedia-sourced cards; each user is served only cards they haven't seen. Cost scales with library size, not users×cards.
- **Never repeat, forever:** durable per-(device, card) seen tracking. If a user drains the whole library, show a graceful "caught up"; rely on continuous generation to stay ahead.
- **Light personalization now, AI-ranking later:** start with concept-affinity + variety; structure the feed as _select unseen → rank_ so an embedding/taste-vector ranker can replace the ranker without a rewrite (cards already carry embeddings).
- **Build Approach A first** (below), structured so the cursor (B) and precomputed-queue (C) optimizations can be added later without a rewrite.

## Approach (chosen: A)

**A — seen table + paginate-and-exclude + swappable ranker.** A `seenCards` table is the durable source of truth. The feed paginates published cards by an index, excludes `seenCards` hits via indexed point-lookups (~25/page), and a ranking step orders the surviving page. Scales to low tens of thousands; the select→rank split is the seam for future AI scoring.

Deferred optimizations (no rewrite needed to add): **B** per-user scan cursor over an append-only order (O(1) scan efficiency when seen-sets get huge); **C** precomputed per-user ranked queue (heavy AI ranking at scale).

## Design

### 1. Data model

- New table `seenCards { deviceId: string, cardId: id<'knowledgeCards'>, seenAt: number }`.
  - Index `by_device_card` `['deviceId','cardId']` — membership lookup + idempotent insert.
  - Index `by_device` `['deviceId']` — count / list (for "running low" + migration).
- `userProfiles`: keep `conceptWeights` (personalization) and `notInterested`. Remove the `seen` array after migration (§5).

### 2. Feed query — select → rank

- `selectUnseen(ctx, deviceId, paginationOpts, limit)`: paginate `knowledgeCards` (status `published`) by an existing index; for each candidate, point-lookup `seenCards.by_device_card` and `userProfiles.notInterested`; drop matches; accumulate up to `limit` unseen, returning them plus the Convex continuation cursor. Never `collect()`-all.
- `rankPage(cards, profile, opts)`: pure function. Light ranker now = concept-affinity (`conceptWeights`) + variety (`shuffleKey`) + optional `focusConcept` boost. Isolated and swappable; today's `scoreCard` is the first implementation, minus the seen penalty (exclusion now handles seen).
- The page feed (`+page.svelte`) consumes this paginated query and loads more on scroll (existing sentinel), so the client paginates through unseen cards continuously.

### 3. Marking seen (hard exclusion)

- On card impression/complete (the existing event path), upsert into `seenCards` (idempotent via `by_device_card`). This is the guarantee for "never twice," replacing the `SEEN_PENALTY` down-rank, which is removed from `scoreCard`.
- Marking is write-light (one small row per first view of a card per device).

### 4. Library growth (sustain thousands/day)

- Increase generation throughput: larger / more frequent `processDemand` batches (exact cadence tuned during implementation against observed consumption).
- Add a **"running low" trigger**: when a device's unseen count (published cards − seen for that device) drops below a threshold, enqueue a generation batch via the existing Workpool — warm-ahead so the pool stays ahead of heavy readers. Bounded by the Workpool's concurrency + per-run caps (no runaway cost).
  - Detection + enqueue: the client calls a lightweight `unseenStatus(deviceId)` query as the feed nears its end (e.g. via the existing scroll sentinel); when it reports below-threshold, the client calls an action that enqueues `processDemand` through the Workpool. Server-side dedupe/throttle prevents repeated enqueues from concurrent triggers. (Kept off the hot feed-read path so the feed query stays cheap.)
- Graceful "caught up" end-state only when generation genuinely can't keep up.

### 5. Migration (widen → migrate → narrow)

- Widen: add `seenCards` table; keep `userProfiles.seen` temporarily.
- Migrate: one-time backfill copying each `userProfiles.seen[]` into `seenCards` rows.
- Narrow: switch reads/writes to `seenCards`, then drop the `seen` array field from `userProfiles`.

### 6. Testing

- convex-test: `selectUnseen` never returns a card in `seenCards` or `notInterested`; pagination advances and terminates; mark-seen is idempotent; "running low" trigger fires at the threshold and enqueues; migration backfill copies arrays correctly.
- Unit: `rankPage` ordering (affinity/variety/focus) with no seen-penalty.

## Non-goals

- Per-user unique generation (rejected — infeasible cost/latency).
- Building the cursor (B) or precomputed-queue (C) now (deferred; design leaves room).
- Replacing the light ranker with AI scoring now (the seam is built; the ranker comes later).
- Cross-device identity/accounts (seen is per device until accounts exist).

## Open items

None blocking. Generation cadence/threshold values are tuned empirically during implementation; the running-low threshold and batch size start conservative and adjust to observed consumption.
