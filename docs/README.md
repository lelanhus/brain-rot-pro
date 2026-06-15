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
- **Next:** a **topic/category allowlist** (design doc §8.2) — top-pageviews is full of current events/sports, and `looksLikeArticleTitle` filters namespaces only. Then batch generation + the admin review UI (currently CLI: `review:queue` / `review:approve`). Phase 3 personalization (concepts, embeddings, candidate pools) follows.

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
