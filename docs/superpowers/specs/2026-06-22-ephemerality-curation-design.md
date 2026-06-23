# Ephemerality-Aware Curation — Design Spec

**Date:** 2026-06-22 · **Status:** Approved · **Direction:** content & feel (curation, sub-project 1)

## Goal

The feed is tonally split: delightful evergreen facts (wombat cube poop, Chernobyl was a safety test, HMS Dreadnought, Einstein dodging the draft) interleaved with grim/ephemeral current-events news ("2026 Iran war", "List of attacks during the 2026 Iran war", the "6-7" meme). That fights the "calm, delightful, one-more-idea" product principle — most acutely at **cold start**, where a brand-new user with no profile sees the global default order before personalization can adapt.

**Framing (agreed):** this is a **supply + freshness** problem, **not** editorial filtering. We do **not** add global topic blocklists — per-user taste (taste vector, dwell weighting, `not_interested`) already buries content a user dislikes, and a global "no politics/no grim" filter would wrongly stop a military-history fan from ever seeing Dreadnought. Personalization only *re-ranks the pool that exists*; it cannot (a) create cards never generated, (b) know a card is now out of date, or (c) fix the unpersonalized cold-start order. Those three are what we fix here.

**Root cause:** the catalog→generation machinery is already correct in shape (catalog accumulates pageviews; generation selects topics where `evergreen !== false`; cold-start default order is `by_pageviews` filtered the same way). The single gap is that `classifyTitle` → `classifyTopic` → `decideArticleStatus` judges topic **type** but not **recency**. "2026 Iran war" is `instance of` war → allowlisted → `evergreen: true` → eligible. We add the missing **ephemerality dimension** and let it flow through the existing `evergreen` flag.

## Decisions (YAGNI)

- **Ephemerality = recency, measured from Wikidata temporal claims + a title fast-path.** Parse `point in time` (P585), `start time` (P580), `inception` (P571) → extract years. A topic is ephemeral if any temporal-anchor year is within `nowYear − windowYears`, **or** its title matches an ephemeral pattern (`^List of `, or a 4-digit year token that itself falls inside the same `[nowYear − windowYears, nowYear]` window — derived from `nowYear`, not hardcoded). `windowYears = 2` (blocks 2025–2026). Keeps WWI (1914), Chernobyl (1986), Dreadnought (1906).
- **Ephemeral beats allow.** Folded into `decideArticleStatus` ahead of the allowlist return, reusing the existing "block wins over allow" precedence. Result is the existing `filtered_out` status → existing `evergreen: false` flag → never generated, and auto-excluded from cold-start default order. **No changes to `generationPipeline` or `crons`.**
- **`nowYear` is injected from the action layer.** No `Date` in pure logic (ADR-007 determinism discipline — same rule as `shuffleKey`). `windowYears` is a constant (`EPHEMERAL_WINDOW_YEARS = 2`), not a stored config.
- **Fail-open on absence.** Missing/failed Wikidata temporal data does **not** block (avoid over-blocking); the title fast-path still applies. Consistent with "Wikidata leads, heuristic catches the tail."
- **Retire existing published cards, reversibly.** Stale news *decays into being wrong* (a frozen "running attack tally" is misinformation within weeks), so ephemeral cards should leave the published pool, not just sink. Reuse the existing **`suppressed`** status (the feed serves only `published`; un-suppress restores). **Dry-run by default**, conservative, auditable.
- **Scope boundary.** This catches ephemeral **events/news**. It does **not** catch trending-**people** trivia whose facts are old (Biden's 1968 grades, Khamenei's 1981 injury) — those are not ephemeral and not low-quality-by-rule, so per the supply-vs-taste line they're left to personalization. Catching trending-people spikes is **deferred Approach B** (`daysSeen` sustained-popularity tracking), explicitly out of scope.

## Components

- `convex/wikidataLogic.ts`:
  - Pure `isEphemeral(args: { temporalYears: number[]; title: string }, nowYear: number, windowYears?: number): { ephemeral: boolean; reason: string }`. `reason` e.g. `recent: 2026` / `title: "List of …"`.
  - `decideArticleStatus(...)` — extend args with `title: string`, `temporalYears: number[]`, `nowYear: number` (and optional `windowYears`). Check `isEphemeral` **first**; if ephemeral → `{ status: 'filtered_out', basis: 'ephemeral: <reason>' }`. Existing allow/block/heuristic logic unchanged below it.
  - `EPHEMERAL_WINDOW_YEARS = 2` constant + the ephemeral title pattern(s).
  - (Optional) add `temporalYears?: number[]` to `TopicClaims` for cohesion; `classifyTopic` ignores it.
- `convex/ingest.ts`:
  - `parseClaims` (currently P31/P279/P106/P18) — also parse P585/P580/P571 → `temporalYears` (extract 4-digit year from each claim's `datavalue.value.time`, e.g. `+2026-06-01T00:00:00Z` → `2026`).
  - All `decideArticleStatus(...)` call sites (`classifyTitle`, and the two in the ingest path) — pass `title`, `temporalYears`, and `nowYear = new Date().getUTCFullYear()` (computed in the action, not pure logic).
- `convex/curation.ts` (**new**): retire-existing pass.
  - `auditEphemeralPublished` (internalAction) — over `published` cards, group by distinct source topic; title fast-path pre-filter; re-fetch Wikidata per remaining distinct topic; run `isEphemeral`. Returns `{ scanned, distinctTopics, wouldSuppress, samples: Array<{cardId, title, reason}> }`. **Mutates nothing.**
  - `suppressEphemeralPublished` (internalAction) — same scan with `{ apply: true }`; flips matched cards `published → suppressed` via an internal mutation; returns the same report plus `suppressed: count`. Bounded per run; logs each decision. Un-suppress is the existing inverse.
  - Surfaced in `/admin` behind the existing admin token (read-only audit + an explicit apply action).

## Data flow

```
ingest/classifyTitle:
  parseClaims(entity) → { instanceOf, subclassOf, occupations, image, temporalYears }
  classifyTopic(claims) → verdict
  decideArticleStatus({ verdict, categories, title, temporalYears, nowYear })
     → isEphemeral first  ⇒ filtered_out (basis 'ephemeral: …')   [recent beats allow]
     → else existing allow / block / heuristic
  ⇒ evergreen = (status !== 'filtered_out')  → setEvergreen(slug)        [supply + cold-start]

retire (admin):
  auditEphemeralPublished        → report only
  suppressEphemeralPublished{apply:true} → published → suppressed (reversible)
```

## Error handling

- Wikidata fetch failure or missing temporal claims → `temporalYears: []` → not ephemeral by recency; the title fast-path still applies (fail-open, never over-block).
- Retire pass: dry-run is the default; bounded refetch count per run; only flips to the reversible `suppressed`; every decision logged with its basis.

## Testing

- **Pure (`wikidataLogic.test.ts`):**
  - `isEphemeral` truth table (nowYear = 2026, window = 2): `{temporalYears:[2026]}` → ephemeral; `{temporalYears:[1914]}` (WWI) / `[1986]` (Chernobyl) / `[1906]` (Dreadnought) / `[]` (wombat) → not; title `"List of attacks during the 2026 Iran war"` → ephemeral; title `"2026 Iran war"` → ephemeral; plain evergreen title → not.
  - `decideArticleStatus`: ephemeral input ⇒ `filtered_out` **even when** `verdict.verdict === 'allow'` (precedence); non-ephemeral path unchanged.
- **convex-test:** `classifyTitle` sets `evergreen: false` for an ephemeral topic (mock Wikidata with a recent temporal claim); `evergreen: true` for an old allowlisted one.
- **convex-test (`curation`):** seed published cards (one ephemeral, one evergreen) → `auditEphemeralPublished` reports exactly the ephemeral one and mutates nothing → `suppressEphemeralPublished{apply:true}` flips only that one to `suppressed`; the evergreen card stays `published`; verify reversibility (un-suppress restores).
- All offline via `npm run verify`.

## Out of scope (future)

- **Approach B** — `daysSeen` sustained-popularity tracking to catch trending-*people* spikes (Biden/Khamenei/Fuentes-style), as a reinforcement on top of this.
- Visual-feel polish — the **second** sub-project of "content & feel" (its own spec).
