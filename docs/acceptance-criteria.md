# Acceptance Criteria

**Last updated:** 2026-06-15
**Purpose:** the clear, checkable criteria each milestone must satisfy. Two kinds of criteria:

- 🤖 **Machine-checkable** — verified by `npm run verify` (see [`engineering-standards.md`](./engineering-standards.md) §4) or a specific automated test. These are what the build-iterate-until-green loop targets.
- 👤 **Human-judged** — observed by Leland (e.g., "is this fun?"). The loop cannot assert these; they gate phase exit, not the build.

A milestone is **done** when *all* its 🤖 criteria pass `verify` **and** its 👤 criteria are confirmed.

---

## Global Definition of Done (every change)

🤖 1. `npm run verify` is green (typecheck + lint + unit + convex-test + e2e).
🤖 2. New Convex functions have `args` + `returns` validators and touched tables are in `schema.ts`.
🤖 3. No empty `catch`, no floating promises, no `any` without a written reason.
🤖 4. New `useQuery` calls pass args as a **getter function** (the silent-failure guard).
🤖 5. Expected failures throw `ConvexError` and are surfaced in UI; unexpected paths bubble to `handleError`→Sentry.
👤 6. The change does what the task said, observed running — not just green tests.

---

## Phase 0 — Card-quality spike (retire the #1 risk before infra)

**Goal:** prove Wikipedia can become cards that are *fun to scroll*, before building any pipeline. ~150–200 hand-/AI-curated cards, dead-simple vertical feed, **no auth, no personalization, no concept graph**.

🤖 Technical gates:
- `npm run verify` green; SvelteKit app builds and deploys to Vercel.
- **SSR-to-live proven:** first card server-rendered with **no loading or null flash**, then upgrades to a live `convex-svelte` subscription (test + manual). (ADR-001)
- Feed is smooth: next cards **prefetched**; swipe/scroll to next is instant (no spinner between cards). Target: interaction-to-next-card < 100ms perceived.
- Each card carries **provenance** (source article URL, revision id, exact source span) and image cards pass the **fail-closed license check** (commons-only, non-free/ambiguous rejected). (ADR-005)

👤 Exit criteria (Leland judges):
- Voluntarily scrolls a **meaningful run of cards in one sitting** without being prompted.
- Reaction is repeatedly *"that was interesting, show me another"* — not *"this reads like chopped-up Wikipedia."*
- Cards feel **short, surprising, and trustworthy**.

> If the 👤 criteria fail, **stop and fix the cards** — no ranking engine rescues boring cards. This is the make-or-break gate.

---

## Phase 1 — Instrumented feed

**Goal:** the same feed, now logging behavior, with content-intrinsic ranking. Still single-user, device-id only.

🤖:
- Events logged (impression, dwell `card_visible_ms`, complete, skip, save, expand), **batched, non-blocking, resilient to reload**, tied to session + impression ids. Event writes never block the UI.
- **Curiosity Continuation Rate (CCR) is computable** from logged events — its definition (dwell threshold normalized by body length; what counts as a continuation) is fixed in code and unit-tested. (Resolves review §4.3)
- Ranking is **content-intrinsic** (quality rubric + diversity + anti-repetition + session adaptation). **No dependence on global stats.** (ADR-007)
- Feed query reads a **bounded, indexed candidate set** (no full-table scan); randomness via a **session seed arg**; volatile counters segregated from the feed query. (ADR-007)

👤:
- Feed still feels fast and fun with instrumentation added (no regression from Phase 0).

---

## Phase 2 — Generation pipeline

**Goal:** automatically turn filtered top Wikipedia articles into publishable candidate cards.

🤖:
- Ingestion via the **Action API behind a source-adapter**, authenticated (free account/OAuth), descriptive User-Agent, cached, concurrency ≤3, seed via dumps/top-pageviews. (ADR-005)
- Generation runs in **Workpool/Workflow**; generator and **validator are different models**. (ADR-003)
- **Source-support validation works:** a card whose hook/body is not entailed by its stored source span is marked `validation_failed` and **never published** (tested). (Resolves review §3.2)
- **Manual approve queue** gates publication — nothing reaches the feed without approval. (review §3.2)
- Prompt/version metadata stored per generated card (model, prompt version, source revision, validation result, scores).

👤:
- Generated cards are *consistently* interesting enough to approve; low rate of unsupported/awkward claims on review.

---

## Phase 3+ — Personalization, then behavioral ranking

🤖:
- Embeddings (via Gateway, ADR-003) computed in **actions**; candidate pools **precomputed** by scheduled jobs; concepts/edges + per-user weights stored. (ADR-007)
- Seen-card suppression; adjacent-concept continuation; wildcard bucket — all reading from the precomputed pool.
- **Global/behavioral ranking + `CardAggregateStats` activate only once there is a user base** (explicitly dormant for single-user). (ADR-007)

👤:
- After 20–50 interactions the feed feels **more personally addictive**; CCR trends up, skips down.

---

## Auth (whenever it lands — deferred past Phase 1)

🤖:
- Only **anonymous + Google + Apple** providers; no email/password. (ADR-004)
- **Test proves** anonymous→Google/Apple linking carries the profile via `onLinkAccount`; `disableDeleteAnonymousUser: true` set.
- Apple specifics handled: JWT client-secret rotation (~6mo), first-auth email/name persisted, HTTPS-only, `appleid.apple.com` in `trustedOrigins`. (ADR-004)

👤:
- Account prompt appears only at a value moment ("Save your feed?"), never blocks the first session.

---

## Before any external (non-Leland) user

These are **release gates**, not build gates:
- 👤/⚖ Revisit CC BY-SA card-licensing with counsel; render attribution + "adapted/modified" + license notice; adopt Wikimedia Attribution API. (ADR-005)
- 🤖 Privacy policy; account/data delete cascades across events/impressions; event-rollup/retention job.
- 🤖 Safety guardrails enforced at ingestion (suppress-list) and rank time (no sensationalism/medical/legal/active-politics).
