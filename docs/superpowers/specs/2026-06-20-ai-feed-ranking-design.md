# AI-backed feed ranking — design

**Date:** 2026-06-20
**Status:** Approved (pending spec review)

## Goal

Rank the unseen feed by what a user actually likes — replacing the light
concept-affinity ranker with embedding/taste-vector similarity — while keeping a
real discovery slice so the feed doesn't become an echo chamber. Slots into the
existing select→rank seam (`feed.unseen`) with no new infrastructure.

## Context (what exists)

- `feed.unseen` (query) paginates published cards, hard-excludes `seenCards` +
  `notInterested`, then ranks the surviving page with `profileLogic.scoreCard`
  (concept-affinity + novelty + focus). The ranker is a separate, swappable step.
- Cards carry an optional `embedding` (1536-dim, `openai/text-embedding-3-small`),
  set on publish + backfilled. `embedLogic.cosineSimilarity` is a pure helper.
- `userProfiles` (per device) holds `conceptWeights`, `notInterested`, etc.,
  rebuilt by `profile.recompute` from the device's events. `EVENT_DELTA` already
  weights event types (save 3, expand/related 2, source_open 1.5, complete 1,
  skip −0.5, not_interested −4).

## Decisions (from brainstorming)

- **Relevance + discovery slice:** rank primarily by taste-similarity, but keep a
  meaningful novelty weight so fresh/off-taste cards keep surfacing.
- **Taste = weighted positive engagement:** taste vector = recency-favored
  weighted average of the embeddings of cards the device engaged with positively
  (save > expand/source-open > complete). Negative signals (skip, not_interested)
  only *exclude* cards (already handled) — they don't reshape the taste vector.
  Cold-start (no positively-engaged embedded card) → fall back to concept-affinity.
- **Approach A (query-side cosine blend):** taste vector lives on `userProfiles`,
  ranking is a pure cosine blend computed in `feed.unseen`. No action / no
  `vectorSearch`; the feed stays a reactive query. Deferred (seam preserved):
  B = action + Convex `vectorSearch` at large scale; C = offline precomputed
  per-user ranked queue.

## Design

### 1. Taste vector — `userProfiles` + `profile.recompute`
- Add optional `tasteVector: v.optional(v.array(v.float64()))` to `userProfiles`.
- `recompute` already loads the cards a device referenced (for `conceptWeights`).
  Extend it: accumulate a **weighted, recency-favored average** of the embeddings
  of positively-engaged cards.
  - Weight per event = positive `EVENT_DELTA` (save 3, related/expand 2,
    source_open 1.5, complete 1; ignore skip/not_interested for taste) ×
    a recency multiplier (exponential decay on event age, half-life tuned in
    implementation; recent engagement counts more).
  - Sum `weight · card.embedding` across positive events whose card has an
    embedding; divide by total weight → the taste vector. (Magnitude is
    irrelevant — cosine normalizes — but averaging keeps values bounded.)
  - If no positively-engaged card has an embedding → write no `tasteVector`
    (omit the field) so the feed stays in cold-start.
- The taste accumulation is a **pure helper in `profileLogic`**
  (`buildTasteVector(events, cardsById)` → `number[] | undefined`), unit-tested
  without a deployment; `recompute` just calls it and stores the result.

### 2. Ranking blend — pure fn in `profileLogic` + `feed.unseen`
- Add `scoreByTaste(card, ctx)` where `ctx = { tasteVector?, weights, shuffleKey, focusConcept? }`:
  - If `tasteVector` is present AND `card.embedding` is present:
    `RELEVANCE_WEIGHT · cosineSimilarity(tasteVector, card.embedding)`
    `+ WILDCARD_WEIGHT · shuffleKey`  (the discovery slice)
    `+ (focusConcept matches ? FOCUS_BOOST : 0)`.
  - Else → fall back to the existing `scoreCard(card.conceptTags, weights, {shuffleKey, focusConcept})`.
  - `RELEVANCE_WEIGHT` is sized so cosine (≈0–1) dominates ordering while
    `WILDCARD_WEIGHT · shuffleKey` still meaningfully reshuffles — keeping a real
    discovery slice. Exact value tuned in implementation; documented as a constant.
- `feed.unseen` reads `profile.tasteVector` once and calls `scoreByTaste` per
  surviving candidate instead of `scoreCard`. Everything else (pagination,
  seen/notInterested exclusion) is unchanged.

### 3. Cold-start / missing-embedding fallback
- No `tasteVector` (new or low-engagement device) → every candidate falls back to
  `scoreCard`: the feed behaves exactly as today. Never worse than the current
  ranker.
- A candidate lacking an `embedding` falls back to `scoreCard` for that card even
  when a taste vector exists, so un-embedded cards still rank sanely.

### 4. Discovery slice
- Provided by the retained `WILDCARD_WEIGHT · shuffleKey` term in the blend —
  fresh/off-taste cards keep surfacing, no echo chamber. A stronger "force every
  Nth card off-taste" injector is explicitly **out of scope** (a later refinement).

## Non-goals
- Convex `vectorSearch`/action-based ranking (approach B) or precomputed per-user
  queues (C) — deferred; the seam is preserved.
- Negative-signal taste steering (subtracting disliked embeddings) — rejected;
  negatives only exclude.
- A forced off-taste injector — deferred.
- Re-embedding cards or changing the embedding model.

## Testing
- Unit (`profileLogic`): `scoreByTaste` ranks a high-cosine card above a
  low-cosine one; falls back to `scoreCard` when `tasteVector` or `card.embedding`
  is absent; novelty term still breaks ties. `buildTasteVector` weights positives
  by `EVENT_DELTA` × recency, ignores skip/not_interested, returns `undefined`
  when no positive embedded card exists.
- convex-test (`profile.recompute`): a device that saved/completed embedded cards
  gets a `tasteVector`; a cold device does not.
- convex-test (`feed.unseen`): with a taste vector, a card embedding-near the
  taste ranks ahead of a far one; still never returns a seen card.

## Open items
None blocking. `RELEVANCE_WEIGHT` and the recency half-life are tuned empirically
during implementation against the constants already in `profileLogic`.
