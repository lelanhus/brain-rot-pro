# Admin interface (ADR-009)

**Status:** phases 1–4 shipped (overview, accounts, content, activity trend). Authored 2026-06-17.
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

## Shipped phases

- **Phase 1 — Analytics overview.** `admin.overview` + `/admin` dashboard (content pipeline, audience, engagement/CCR, monetization).
- **Phase 2 — Account management.** `admin.accounts` (list, merged from `deviceStats` + `userProfiles` + saves) and `admin.account` (single: streak, top concepts, saves, recent events). `/admin/accounts` list + `/admin/accounts/[deviceId]` detail with the GDPR **data-delete cascade** (`account.deleteData`) behind a two-step confirm.
- **Phase 3 — Content management.** `admin.cards` (status filter + hook search) and `admin.setCardStatus` (publish/suppress; publishing schedules the embedding like `review.approve`). `/admin/content` defaults to the `needs_review` queue, so it doubles as the gated review surface.
- **Phase 4 — Activity trend.** `dailyActivity` folds the event stream into a 14-day impressions/continuations series, rendered as a bar panel on the overview. (Funnel + retention curves + per-concept performance remain for a later pass, behind the Aggregate component once volume warrants.)

## Follow-ups

- The legacy `/review` page + `review.ts` CLI remain (ungated) for now; `/admin/content` supersedes the page. Retire `/review` or fold its functions behind `assertAdmin` in the auth pass.
- Move per-account analytics + activity off full scans onto the **Aggregate** component when the user base grows.

## Security note

The shared-secret gate is a single-operator stopgap (ADR-004 defers real accounts). When Better Auth lands, swap `assertAdmin(token)` for an `ctx.auth` role check — call sites don't change — and fold `/review` fully under `/admin`.
