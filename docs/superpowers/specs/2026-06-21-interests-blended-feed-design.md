# Interests Model + Blended Feed — Design Spec

**Date:** 2026-06-21
**Status:** Self-approved (autonomous goal: best-judgement, no user round-trip)
**Sub-project:** 3 of 6 in the "Topics & Interests" system

## Goal

Let a user's **explicit** interests (topics they choose to follow) influence the
single "For You" feed, with a place to manage them. Builds the `interests` data
model that sub-projects 4 (search), 5 (onboarding), and 6 (auto-discovery) all
write into.

## Design decisions (YAGNI, made autonomously)

- **Interests are catalog topics (slugs).** An interest = a `topics` slug + its
  title + a `source` (`'explicit'` now; `'discovered'` in SP6). Implicit interest
  already lives in `userProfiles.tasteVector`/`conceptWeights` (engagement-derived)
  and is NOT duplicated here — `interests` is for chosen/discovered topics.
- **Per-device**, keyed on `deviceId` like everything else (anonymous-first).
- **Card↔topic link** reuses the existing convention: a card belongs to the topic
  `toSlug(card.source.articleTitle)` (same mapping SP1/SP2 use).
- **Blend, don't replace.** The feed keeps its taste-vector ranking; following a
  topic adds a fixed `INTEREST_BOOST` to that topic's cards. One term, one const.
- **Add path in SP3 = "Follow this topic" on a card** (follows the card's source
  topic). It's the minimal honest entry point and is browser-testable now; search
  (SP4) and onboarding (SP5) add richer entry points later.
- **Following triggers generation** of that topic via the SP2 `generateForTopic`
  (no-op if it already has a card) so an interest can yield content.

## Architecture

A new `interests` table (deviceId + slug, deduped) with add/remove/list. The
feed query loads the device's interest slugs and passes them to the pure
`scoreByTaste`, which adds `INTEREST_BOOST` to cards whose source-topic slug is
followed. The card UI gains a follow toggle; `/account` gains an interests list
with remove.

### Data model — `interests` table

```ts
interests: defineTable({
  deviceId: v.string(),
  slug: v.string(),       // topics slug, e.g. 'cleopatra'
  title: v.string(),      // display title, e.g. 'Cleopatra'
  source: v.string(),     // 'explicit' | 'discovered'
  createdAt: v.number(),
})
  .index('by_device', ['deviceId'])
  .index('by_device_slug', ['deviceId', 'slug']),  // dedupe + remove
```

## Components

- **`convex/interests.ts`** (new):
  - `add` (mutation) — args `{ deviceId, slug, title }`. Dedupe via
    `by_device_slug`; insert with `source: 'explicit'`, `createdAt` if absent.
    Then `ctx.scheduler.runAfter(0, internal.generationPipeline.generateForTopic, { slug })`
    (ensure the topic has a card; idempotent).
  - `remove` (mutation) — args `{ deviceId, slug }`; delete the matching row.
  - `list` (query) — args `{ deviceId }`; rows for the device, newest first.
- **`convex/feed.ts`** (modify `unseen`): load the device's interest slugs into a
  `Set<string>`; pass `interestSlugs` to `scoreByTaste`, and pass each card's
  `slug = toSlug(card.source.articleTitle)`.
- **`convex/profileLogic.ts`** (modify `scoreByTaste` + add `INTEREST_BOOST`):
  accept `interestSlugs?: ReadonlySet<string>` in ctx and `slug?: string` on the
  card; after computing the base score (taste branch or scoreCard fallback), add
  `INTEREST_BOOST` when `interestSlugs?.has(slug)`. `INTEREST_BOOST` is tuned
  below the dominant `RELEVANCE_WEIGHT` so taste still leads but followed topics
  surface sooner (value chosen in the plan, ~ the FOCUS_BOOST scale).
- **`src/lib/components/CardActions.svelte`** (modify): add a "Follow topic"
  toggle that calls `interests.add` / `interests.remove` for the card's source
  topic, reflecting followed state from `interests.list`.
- **`src/routes/account/+page.svelte`** (modify): an "Interests" panel listing
  followed topics with a remove control.

## Data flow

```
card "Follow" ─▶ interests.add(deviceId, slug, title) ─▶ scheduler ─▶ generateForTopic(slug)
/account ◀─ interests.list(deviceId) ─▶ remove
feed.unseen ─▶ interests slugs (Set) ─▶ scoreByTaste(card{+slug}, {..., interestSlugs}) +INTEREST_BOOST
```

## Error handling

- `add` is idempotent (dedupe by device+slug); double-follow is a no-op.
- `remove` of a non-followed slug is a no-op.
- Feed blend is additive and guarded (`interestSlugs?.has`) — empty/absent
  interests leave ranking unchanged (cold-start safe).
- Convex conventions: `internal*` privacy where applicable; explicit
  `=== undefined`/`!== null`; scheduler for the cross-action generate trigger.

## Testing

- Pure (`profileLogic.test.ts`): `scoreByTaste` adds `INTEREST_BOOST` exactly
  when the card's slug is in `interestSlugs`, in both the taste-vector branch and
  the scoreCard fallback; no boost when absent/empty.
- `convex-test` (`interests.test.ts`): `add` dedupes (same device+slug once);
  `remove` deletes; `list` returns the device's rows; `add` schedules
  `generateForTopic` (assert via the scheduler, or accept as the documented
  orchestration boundary if scheduler isn't observable under convex-test).
- `convex-test` (`feed.test.ts`): a followed topic's card ranks above an
  equivalent unfollowed card (seed two cards, follow one's topic, assert order).
- **Browser (human-like):** follow a topic from a card → it appears in
  `/account` Interests → the feed surfaces it → remove it from `/account`.

## Scope boundary

- No search UI (SP4), no onboarding (SP5), no auto-discovery/`'discovered'`
  population (SP6 — the `source` field is ready for it).
- Implicit interest (tasteVector) is unchanged; this only adds the explicit layer.
- 1 card per topic stays (SP2); following surfaces/ranks, it doesn't deepen.

## Risks

- **Low marginal value at 1 card/topic:** following mainly affects ranking + is a
  signal for SP6 discovery; depth (multiple cards/topic) would amplify it later.
  Acceptable — the model + blend are the deliverable.
- **Boost tuning:** set `INTEREST_BOOST` so it nudges, not dominates, the
  taste-ranked feed; pick a concrete value in the plan and keep it a single
  named const for easy tuning.
