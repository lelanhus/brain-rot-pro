# Topic Search — Design Spec

**Date:** 2026-06-21 · **Status:** Self-approved (autonomous goal) · **Sub-project:** 4 of 6

## Goal
Let users search the topic catalog and follow topics from the results. Frontend-only — reuses `topics.search` (SP1) and `interests.add/remove` (SP3).

## Decisions (YAGNI)
- A dedicated `/search` route reached from a new "Explore" pill in the feed nav (next to Saved/Account).
- Live typeahead over `api.topics.search` (min 2 chars; getter-args + 'skip' pattern).
- Each result is a row: title + a Follow/Following toggle (`interests.add`/`interests.remove`, mirroring SP3's `followedSlugs`). Following a result triggers generation (via `interests.add`'s existing `generateForTopic` schedule) and boosts the feed (SP3).
- **No separate "drill-in" topic view** (the SP1 vision's drill-in): at 1 card/topic it would show ~one card — low value. Following surfaces the topic in the main blended feed instead. Drill-in is deferred until topic depth exists.
- No new Convex functions.

## Components
- `src/routes/search/+page.svelte` (new): `q` `$state`; `deviceId` from `getDeviceId` onMount; `results = useQuery(api.topics.search, () => q.trim().length >= 2 ? { query: q, limit: 20 } : 'skip')`; `interestsQuery`/`followedSlugs`/`addInterest`/`removeInterest` (same shape as `+page.svelte`); results list with per-row Follow toggle keyed on `i.slug`; short-query + no-results states.
- `src/routes/+page.svelte` (modify): add `<a class="nav-pill" href={resolve('/search')}>Explore</a>` to `.feed-nav` (line ~381).

## Data flow
```
/search input → topics.search(query) → results
  row Follow → interests.add(deviceId, slug, title) → (SP3 boost + generateForTopic)
  row Following → interests.remove(deviceId, slug)
followed state ← interests.list(deviceId)
```

## Error handling
- Short/empty query → 'skip' (no query fired); empty results → friendly empty state.
- deviceId guard on add/remove (no-op until resolved).

## Testing
- Optional component test for the result-row toggle if straightforward.
- **Browser (human-like):** open /search via the Explore pill, type a query, see results, Follow one, confirm Following state + that it shows in /account Interests.

## Scope boundary
No drill-in topic feed; no onboarding (SP5); no discovery (SP6). Search uses the existing title search index (no ranking changes).

## Risks
- Catalog title search is exact-ish (Convex search index); typos may miss. Acceptable for v1; fuzzy/semantic search is a future lever.
