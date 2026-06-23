# Auto-Discovery — Design Spec

**Date:** 2026-06-21 · **Status:** Self-approved (autonomous goal) · **Sub-project:** 6 of 6 (final)

## Goal

Broaden a user's interests automatically: when they follow a topic (explicit), find a few _related_ catalog topics and add them as `discovered` interests — so the blended feed (SP3) and generation (SP2) widen without manual effort.

## Decisions (YAGNI)

- **Relatedness source = Wikipedia "morelike" search.** For an explicit interest's article title, query the MediaWiki search API `srsearch=morelike:<title>` (reusing the `USER_AGENT`/`api.php` pattern from `ingest.ts`). This is semantic relatedness from Wikipedia's own index — no topic embeddings needed (those stay deferred; embedding the whole catalog is the cost we avoid).
- **Filter to the catalog.** Keep only candidates whose slug already exists in `topics` (so they're real, ranked, and generation-ready) and that the user doesn't already follow. Rank survivors by catalog `pageviews`, take the top **3**.
- **Trigger on explicit follow.** `interests.add` (SP3) schedules a discovery pass for the just-followed topic. Discovered interests do NOT trigger further discovery (no recursion) — they're added via a separate internal mutation.
- **Reuse the existing plumbing:** discovered interests are rows with `source: 'discovered'`; they already get the feed `INTEREST_BOOST` (SP3) and `generateForTopic` (SP2) — no feed/generation changes needed.
- Bounded + cheap: ≤3 discoveries per follow, catalog-gated, network only on follow.

## Architecture

A new `discovery.ts` action `discoverFor({deviceId, slug, title})` (scheduled from `interests.add`): fetch related titles via Wikipedia morelike, map to catalog slugs, drop already-followed + non-catalog, rank by pageviews, take top 3, and `interests.addDiscovered` each. A pure `pickDiscoveries` helper does the dedupe/cap (unit-tested); the network orchestration is the documented coverage boundary (like `generateForTopic`).

## Components

- **`convex/discoveryLogic.ts`** (pure): `pickDiscoveries(candidates: {slug,title,pageviews}[], followed: ReadonlySet<string>, limit: number): {slug,title}[]` — drop `followed`, dedupe by slug, sort by `pageviews` desc, take `limit`.
- **`convex/interests.ts`** (modify): add `addDiscovered` (internalMutation) — insert `source:'discovered'` (dedupe by device+slug), schedule `generateForTopic`, NO discovery schedule. Modify `add` to also `ctx.scheduler.runAfter(0, internal.discovery.discoverFor, { deviceId, slug, title })` on a NEW explicit insert.
- **`convex/discovery.ts`** (new):
  - `relatedTitles(title): Promise<string[]>` — fetch `…/w/api.php?action=query&list=search&srsearch=morelike:<title>&srlimit=12&format=json&origin=*` with `USER_AGENT`; return article titles (excluding the source title). Best-effort (return `[]` on non-ok / error).
  - `candidateBySlug` (internalQuery) — given slugs, return the catalog rows that exist (slug,title,pageviews). (Or loop `topics.bySlug`.)
  - `discoverFor` (internalAction) — args `{deviceId, slug, title}`: `relatedTitles(title)` → map each to `toSlug` → look up catalog rows → load the device's followed slugs (`interests.list`) → `pickDiscoveries(catalogCandidates, followedSet, 3)` → `interests.addDiscovered` each.

## Data flow

```
explicit follow → interests.add → schedule discoverFor(deviceId, slug, title)
  discoverFor: morelike(title) → toSlug → topics(catalog) ∩ candidates, minus followed
             → pickDiscoveries(top 3 by pageviews) → interests.addDiscovered (source='discovered')
  → discovered interests feed-boosted (SP3) + generated (SP2); no recursion
```

## Error handling

- `relatedTitles` best-effort: API failure/empty → `[]` → no discoveries (the follow still succeeds; discovery is additive).
- Catalog-gating ensures discovered topics are real + generation-ready.
- Dedupe vs already-followed prevents duplicates / churn; cap 3 bounds growth and cost.
- No recursion: `addDiscovered` never schedules discovery.

## Testing

- Pure (`discoveryLogic.test.ts`): `pickDiscoveries` drops followed, dedupes, sorts by pageviews desc, caps at limit.
- `convex-test` (`interests.test.ts`): `addDiscovered` inserts with `source:'discovered'` + dedupes.
- **Coverage boundary:** `discoverFor`'s Wikipedia fetch + scheduling is not unit-tested (network), consistent with the pipeline's pattern; verified by a controller check (follow a topic, observe `discovered` interests appear).
- **Browser/data (human-like):** follow a topic, then confirm new `source:'discovered'` interests appear (in /account Interests and/or via a data query).

## Scope boundary

No topic embeddings; no UI changes (discovered interests surface through the existing /account list + feed). morelike is the only relatedness source (v1).

## Risks

- morelike quality varies; catalog-gating + pageview ranking keeps discoveries sane. If morelike is unavailable, discovery silently no-ops (degrades gracefully).
- Discovered interests mix into /account with explicit ones (no source label in UI v1) — acceptable; a "discovered" badge is a future polish.
