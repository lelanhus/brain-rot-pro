# Admin interface (ADR-009)

**Status:** in progress — phase 1 (analytics overview) shipped. Authored 2026-06-17.
**Depends on / respects:** the admin gate (`assertAdmin`, ADR-008 phase B), ADR-007 (admin reads are off the feed path), ADR-004 (auth deferred — this is the pre-auth operator surface), engineering-standards §1/§3.

**Goal:** an internal operator console for running the product — content pipeline, audience, engagement, monetization, and (next) per-account management — all behind the `/admin` gate, structured so each section is a page that drops in under the shared layout.

---

## Architecture

- **One gate, many pages.** `/admin/+layout.svelte` collects the shared secret (`src/lib/admin.svelte.ts`, localStorage) and wraps every `/admin/*` route; `assertAdmin(token)` is the real boundary on every admin function. New sections are just a `+page.svelte` + a gated query.
- **Read-side is a thin "read tables → pure fold."** Aggregation lives in pure, unit-tested helpers (`convex/adminLogic.ts`); the query (`convex/admin.ts`) only reads and assembles. This keeps counting testable without a deployment.
- **Full scans are acceptable here, not in the feed.** Admin queries are gated and infrequent, so they may scan tables (same trade-off `metrics.ts` documents). The feed path stays untouched (ADR-007). ⚠ When the user base grows, move these rollups behind the **Aggregate** component rather than scanning.
- **CCR stays single-sourced.** The continuation-event definition is mirrored from `src/lib/metrics.ts` (the unit-tested source of truth) with a sync comment, as in `convex/metrics.ts`.

## Phase 1 — Analytics overview (shipped 2026-06-17)

- **`admin.overview`** (gated query) folds the live state into one payload:
  - **Content:** cards by lifecycle status, published count, total cards, source articles.
  - **Audience:** devices, active-today (UTC), saves, max + average current streak.
  - **Engagement:** total events, impressions, continuations, **CCR**, full by-type breakdown.
  - **Monetization:** sponsored impressions / clicks / CTR (from the event stream).
- **`/admin` dashboard** — headline stat cards + content-pipeline and events-by-type panels. Surfaces an unauthorized state with a re-enter-token path.
- Pure folds (`bucketByType`, `bucketByStatus`, `summarizeEngagement`, `summarizeAudience`) are unit-tested; the gated query is convex-tested (including token rejection).

## Roadmap (driving autonomously; a PR per phase)

- **Phase 2 — Account management.** List/search device accounts (`userProfiles` + `deviceStats`), view a single account (saves, streak, recent events, sync history), and run the GDPR **data-delete cascade** (`account.deleteData`, already exists) with a confirm step. Suppress/restore a device if needed.
- **Phase 3 — Content management.** Promote the existing `/review` queue under `/admin` (and behind `assertAdmin`), plus card search, manual status changes (publish/suppress), and generation/ingestion health (support-score distribution, drafts awaiting review, articles lacking a card). Trigger `generate:generateBatch` / ingest from the UI.
- **Phase 4 — Deeper analytics.** Time-series (DAU/retention curves), funnel (impression → complete → save), per-concept performance, and monetization trends — backed by the Aggregate component once volume warrants.

## Security note

The shared-secret gate is a single-operator stopgap (ADR-004 defers real accounts). When Better Auth lands, swap `assertAdmin(token)` for an `ctx.auth` role check — call sites don't change — and fold `/review` fully under `/admin`.
