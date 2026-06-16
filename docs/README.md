# Brain Rot Pro — Documentation

A zero-friction, AI-generated knowledge feed sourced from Wikipedia/Wikimedia.

## Read in this order

1. **[`design-doc-v0.1-review.md`](./design-doc-v0.1-review.md)** — verification + gap analysis of the original design doc. Identifies the pre-MVP blockers (text licensing, rate limits, source-grounding, cold start) and the over-engineering risk. _Some decisions here are superseded — see #2._
2. **[`architecture-decisions.md`](./architecture-decisions.md)** — **authoritative** locked decisions (ADRs), each confirmed with 2026 sources and caveats. The stack: SvelteKit + Svelte 5 + `convex-svelte`, Convex, Vercel AI SDK/Gateway, deferred Better Auth (anonymous + Google/Apple), Wikimedia free tier.
3. **[`engineering-standards.md`](./engineering-standards.md)** — _fail fast, never fail silently._ Conventions, the `convex-svelte` silent-failure footguns, testing strategy, and **the `npm run verify` loop** to iterate against.
4. **[`acceptance-criteria.md`](./acceptance-criteria.md)** — Definition of Done + per-phase 🤖 machine-checkable / 👤 human-judged gates. Phase 0 (card-quality spike) is the make-or-break.
5. **[`ui-ux.md`](./ui-ux.md)** — mobile-first (desktop first-class) UX spec: design tokens, card/action spec, keyboard + gestures, motion, state catalog, accessibility, and UX acceptance gates. Foundational sections build now; "feel" sections refine after the Phase-0 content read.

## Current status

- Stack decisions: **locked** (architecture-decisions.md).
- **Phase 0 (feed)** — done: SvelteKit + Svelte 5 + `convex-svelte` feed, SSR-to-live, 18 source-backed seed cards.
- **Phase 1 (interaction + events)** — done: Save / Not-interested / source / related actions, keyboard parity, batched telemetry, dwell→complete/skip, saved state, CCR metric. All `verify`-green and validated via convex-test + component tests.
- **Phase 2 (ingestion)** — done: Wikimedia Action API adapter + top-pageviews, storing `sourceArticles` with full provenance (revision id, grounding paragraphs, categories). Validated against live Wikipedia.
- **Phase 2 (generation)** — done & validated live: `generate.ts` turns an ingested article into a card via the Vercel AI Gateway (AI SDK v6), with a verbatim-span guard + a **different** validator model scoring support; drafts land as `needs_review` and reach the feed only via the `review.ts` approve queue. Confirmed end-to-end (a generated Roman-concrete card, support 0.92, approved, live). Models are env-overridable (`GENERATION_MODEL` / `VALIDATION_MODEL`).
- **Phase 2 (hardening)** — done: a content-category **topic filter** (`isEvergreenArticle`) drops sports/entertainment/current-events noise; **`generate:generateBatch`** generates cards for ingested articles lacking one; an in-app **`/review`** admin queue (approve/reject) and a **`/saved`** view. Validated live (Volcano ingested / Ronaldo filtered; batch → 2 `needs_review` cards at support 0.95).
- **Phase 3 (personalization)** — done & validated live: a precomputed per-device **profile** (concept weights / seen / not-interested) drives `feed.personal`, which the feed switches to after the device id resolves and re-ranks live after strong signals (`profile.recompute`). Reads the profile (one cheap doc), not raw events (ADR-007). Confirmed live: a save + not-interested re-ranked the liked card to #1 and excluded the disliked one.

**The v1 core loop is complete:** open → scroll → react → the feed adapts; and content flows top-pageviews → filtered ingest → generate → cross-model validate → review → publish.

### Engagement layer (retention hooks)

- **Explore pathways** — done: tapping a card's concept chip focuses the feed on that concept (an additive re-rank via `feed.personal`'s `focusConcept`, never a filter, so the feed can't empty), jumps to the top, and shows a dismissible "Exploring" pill. Still a strong personalization signal.
- **Momentum** — done: a per-device **daily streak** (`deviceStats` + `stats.ts`, idempotent within a UTC day; pure math in `streakLogic.ts`) plus a **live session counter** and milestone celebrations. The feed shows a 🔥 streak pill (reactive via `stats.get`) and a ✨ count that ticks as cards complete; streak extensions and session milestones (5/10/25/50/100) fire a transient toast. Stats live outside `userProfiles` so they never invalidate the feed query (ADR-007).
- **Installable + collection** — done: a web manifest, theme-color, apple-touch + maskable icon and a custom app glyph make it an installable, standalone PWA (`viewport-fit=cover` so the safe-area CSS engages). The **Saved** view is a real collection manager — count, image thumbnails, inline remove (optimistic), relative save times, and concept chips that deep-link back into the feed's focus (`/?focus=<concept>`).

### Post-v1 backlog (enhancements / release gates, not core loop)

- **Auth** (deferred by design, ADR-004): Better Auth anonymous + Google/Apple when save-across-devices matters.
- **Images** — done: ingest fetches each evergreen article's lead image and clears it through a **fail-closed** free-license check (`imageLicense.ts`: CC0 / public domain / CC BY / CC BY-SA only; NC/ND, restricted, non-free, or unknown → no image). Cleared images carry full attribution (author, license short name + deed URL, Commons page) onto the source article, then onto the generated card, and render with an inline credit line. Unit-tested against the license matrix; the feed never ships an unlicensed asset.
- **Semantic adjacency**: card embeddings + vector search for "more like this" (concept-based pathways work today).
- **Wikidata topic allowlist** (positive) to replace the exclusion heuristic.
- **Before external users**: CC BY-SA card-licensing decision + counsel, privacy policy + data-delete cascade, authenticated/Enterprise Wikimedia access for bulk, analytics rollups (Aggregate component).

## Running it

```bash
npm install
npx convex dev                                   # one-time: deployment + PUBLIC_CONVEX_URL
npm run convex:seed                              # load the Phase-0 cards
npx convex run ingest:topTitles '{"limit":20}'   # candidate articles from top pageviews
npx convex run ingest:ingestTitles '{"titles":["Roman concrete","Octopus"]}'
npx convex run generate:generateFromArticle '{"articleId":"<id from ingest:recent>"}'
npx convex run review:queue                      # inspect generated drafts
npx convex run review:approve '{"cardId":"<id>"}'  # publish a reviewed card
npm run dev                                      # the feed
npm run verify                                   # the loop: typecheck + lint + unit + convex + component
```

`npm run verify` is the iterate-until-green gate (offline). `npm run verify:full` adds the SSR Playwright e2e (`E2E_LIVE=1`, needs a live deployment); the interaction e2e additionally needs a WebSocket-capable browser (`E2E_WS=1`).
