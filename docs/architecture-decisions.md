# Architecture Decisions

**Status:** authoritative. Supersedes conflicting recommendations in `design-doc-v0.1-review.md`.
**Last updated:** 2026-06-15
**Confirmation:** every decision below was verified against current (2026) primary sources; citations and caveats are inline. Where a dependency is pre-1.0 or a feature is recent, it is flagged **⚠ validate-on-adoption** with the specific thing to prove before relying on it.

Format: lightweight ADRs. Each has a one-line **Decision**, the **Why**, **Confirmed** facts with sources, and **Caveats / validate-on-adoption**.

---

## ADR-001 — Frontend: SvelteKit + Svelte 5 + `convex-svelte` ✅ GO

**Decision:** Build the client as a **SvelteKit** app using **Svelte 5 (runes)** and the official **`convex-svelte`** client. Not TanStack/React.

**Why:**

- The two owner pain points — React re-render thrash and front-end cache-layer complexity — are exactly where Svelte + Convex win. Svelte 5 runes are fine-grained reactivity: only the DOM bound to changed state updates, no virtual-DOM diffing and no `useMemo`/`memo` discipline. Convex's push-based subscriptions mean **there is no client cache to invalidate** (we use Convex's native reactivity, _not_ TanStack Query).
- Hard "incredibly fast" bar: smallest bundle / no VDOM overhead during scroll + prefetch.
- SvelteKit SSR is **stable** (post-2.0), unlike TanStack Start which is still an RC — so the anticipated SSR share-pages story is _more_ proven on this path.

**Confirmed:**

- `convex-svelte` is the official Convex Svelte client, **v0.13.0**, peer deps `svelte@^5.19.0`, `convex@^1.30.0`; full Svelte 5 runes support; `useQuery()` returns `.data`/`.error`/`.isLoading`/`.isStale`. ([convex-svelte](https://github.com/get-convex/convex-svelte), [Convex Svelte docs](https://docs.convex.dev/client/svelte))
- **SSR-to-live is first-class as of 0.13.0** via `convex-svelte/sveltekit`: `convexLoad()` / `convexLoadPaginated()` in a `load` function render initial data server-side and **auto-upgrade to a live WebSocket subscription on hydration with no loading flash**. Auth-aware SSR via `withServerConvexToken()` + `setupAuth()`/`useAuth()`. `convexLoadPaginated()` is purpose-built for a feed. ([convex-svelte 0.13.0](https://github.com/get-convex/convex-svelte/releases/tag/v0.13.0))
- SvelteKit deploys to Vercel with SSR via `@sveltejs/adapter-vercel`.

**Caveats / validate-on-adoption:**

- `convex-svelte` is **pre-1.0** and the **SSR/transport path is recent (shipped mid-2025)** — ⚠ in the Phase-0/1 spike, prove: (a) SSR first paint with no loading or null flash, (b) clean upgrade to a live subscription, (c) the paginated feed load. If the official path disappoints, the community `convex-sveltekit` (axel-rock) offers similar ergonomics but is **explicitly experimental** — do not depend on it for core.
- Use `convex-svelte`'s native reactivity. **Do not add TanStack Query** — it reintroduces the cache-config surface we are deliberately avoiding.

---

## ADR-002 — Backend: Convex ✅ GO

**Decision:** Convex is the single backend "brain" — data, reactive queries, scheduled generation jobs, vector search, and the component ecosystem.

**Why:** It does the actual hard work (reactivity, jobs, vector search, components for rate-limiting/workflows/RAG). The frontend choice is deliberately kept thin and swappable on top of it.

**Confirmed:** Official components exist — Rate Limiter, Workpool, Workflow, Migrations, Aggregate, Sharded Counter, R2, RAG, Agent, Better Auth. ([convex.dev/components](https://www.convex.dev/components)) Vector search: 2–4096 dims, ≤16 filter fields, ≤256 results, indexes only the first 100k docs, **runs only in actions (not queries)**. ([Convex vector search](https://docs.convex.dev/search/vector-search))

**Caveats:** see **ADR-007** for the query/ranking architecture this forces.

---

## ADR-003 — AI: Vercel AI SDK v6 + AI Gateway, called from Convex actions ✅ GO

**Decision:** All model calls (generation, validation, embeddings) go through **Vercel AI Gateway** via the **Vercel AI SDK (v6)**, invoked **server-side inside Convex actions**. Use **two different models**: a strong generator and a separate validator/judge. Embeddings via Gateway.

**Why:** Gateway is GA, **pass-through pricing (zero token markup)**, with fallbacks/budgets/observability, and **supports embeddings** — closing the doc's open question. Cross-model validation (generator ≠ judge) is more honest than self-grading. Putting calls in Convex actions keeps them framework-independent (the frontend choice in ADR-001 does not touch the AI layer).

**Confirmed:** AI Gateway GA, pass-through, embeddings endpoint (OpenAI `text-embedding-3-*`, Cohere, Voyage, Google). AI SDK v6 GA with `generateObject` (Zod structured output) + `embed`/`embedMany`. ([AI Gateway](https://vercel.com/docs/ai-gateway), [AI SDK 6](https://vercel.com/blog/ai-sdk-6))

**Caveats:** Convex actions time out at 10 min and are at-most-once (not auto-retried) — orchestrate multi-step generation with the **Workpool/Workflow** components, not one long action.

---

## ADR-004 — Auth: deferred past Phase 1; then Better Auth (anonymous + Google + Apple only) ✅ GO (deferred)

**Decision:** **No auth in Phase 0/1** — use a local device id. When account value appears (save-across-devices), add **Better Auth** via the Convex component with **only** the Anonymous plugin + **Google** + **Apple** social providers. No email/password. Anonymous→social via `onLinkAccount`, with `disableDeleteAnonymousUser: true`.

**Why:** A single founder-user needs no auth yet; deferring removes the biggest dependency risk from the critical path. "Anonymous or social only" matches the owner's stated preference exactly.

**Confirmed:** Anonymous plugin coexists with Google + Apple; linking via `onLinkAccount({ anonymousUser, newUser })`; Better Auth + Convex component supports social providers; official Better Auth + SvelteKit + Convex guide exists. ([anonymous plugin](https://better-auth.com/docs/plugins/anonymous), [Convex+BetterAuth SvelteKit guide](https://labs.convex.dev/better-auth/framework-guides/sveltekit))

**Caveats / validate-on-adoption:**

- `@convex-dev/better-auth` is **pre-1.0 (0.12.3)**, **pinned to `better-auth >=1.6.11 <1.7.0`** (do not bump Better Auth independently), with some experimental sub-features. ⚠ When adopted, **write a test proving the anonymous profile actually carries over on anonymous→Google/Apple linking** — there are reported bugs where `onLinkAccount` did not fire.
- **Apple sign-in gotchas to design for up front:** client secret is a **JWT that expires (~6 months max)** and must be regenerated; `clientId` is the Apple **Services ID** (+ `appBundleIdentifier` for native `idToken`); **email/name are returned only on the first authorization** — persist them immediately; **no localhost/non-HTTPS even in dev**; add `https://appleid.apple.com` to `trustedOrigins` (Apple uses a `form_post` POST redirect). ([Apple provider](https://better-auth.com/docs/authentication/apple))

---

## ADR-005 — Source & content: Wikimedia free tier; Action API behind an adapter; licensing deferred while private ✅ GO

**Decision:** Stay on the **free** Wikimedia tier for now. Fetch via the **MediaWiki Action API** behind a **source-adapter** abstraction. **Attribute** sources; **defer the card-licensing decision** while the app is private/single-user — but **capture full provenance on every card from day one**.

**Why (free tier is viable now):** At single-user volume, batched server-side ingestion is well within free limits if designed for the 2026 rate regime.

**Confirmed / how:**

- 2026 limits: ~10 req/min anonymous → use a **free Wikimedia account + OAuth 2.0** (~200/min), a descriptive **User-Agent with contact email**, concurrency ≤3, **cache every fetch in Convex**, and prefer **dumps** for bulk seed. ([rate limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits))
- Use the **Action API** (`/w/api.php`) — `rest_v1`/RESTBase and the `api.wikimedia.org` Core REST API are deprecating 2026–2027. ([deprecation](https://wikitech.wikimedia.org/wiki/API_Portal/Deprecation))
- **Licensing posture:** English Wikipedia text is CC BY-SA 4.0; ShareAlike/attribution obligations trigger on **public distribution** of a derivative, **not private use**. So while the app is private to Leland, attribute + defer the formal card license. ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/legalcode), [WMF ToU](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use)) **Non-negotiable:** store source URL, **revision id**, author/attribution string, and the **exact source span** per card so applying a license later is a config change, not a re-ingestion.
- **Images:** pull from **commons.wikimedia.org only**, parse `imageinfo`→`extmetadata`, **fail closed** on `NonFree=true` / missing / ambiguous license, render required attribution. ([imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo), [Commons licensing](https://commons.wikimedia.org/wiki/Commons:Licensing))

**Caveats / before external users:** the moment the app is distributed to anyone but Leland, revisit the CC BY-SA card-licensing decision (likely: visible attribution + "adapted/modified" + CC BY-SA notice) **with counsel**. Adopt the Wikimedia Attribution API to make it turnkey.

---

## ADR-006 — Deployment: Vercel ✅ GO

**Decision:** Deploy the SvelteKit app on **Vercel** (`@sveltejs/adapter-vercel`). Convex runs as its own hosted backend; AI Gateway is Vercel-native.

**Why:** Keeps frontend + AI layer in one ecosystem; SvelteKit-on-Vercel SSR is supported. Cloudflare Pages is an equally fine alternative (the VoidZero/Vite acquisition doesn't force this either way; Vite stays vendor-neutral/MIT). Set `PUBLIC_CONVEX_URL` etc. as Vercel env vars; Better Auth env (when added) is set via the Convex CLI/dashboard, not `.env.local`.

---

## ADR-007 — Personalization/feed compute: precompute candidate pools, light feed query ✅ GO (architectural rule)

**Decision:** Do **not** rank by scanning the cards table in a reactive query. **Precompute candidate pools** (embeddings + global scores) in scheduled actions/mutations; the **feed query reads a small, indexed, materialized candidate set** and does only light per-request ordering. Inject randomness/wildcards via a **client-supplied session seed**, not in-query RNG. **Segregate volatile counters** (impressions/saves/skips) into separate docs (or Aggregate/Sharded Counter) so the feed query doesn't subscribe to them.

**Why (forced by Convex's model):** Vector search runs only in actions; queries are deterministic+cached and re-run when any read doc changes (so reading volatile counters causes constant invalidation); `Math.random()`/`Date.now()` in queries break the subscription model; hard per-txn limits (~32k docs scanned, 16 MiB, 1s CPU) make "score every card" eventually fail. ([Convex queries](https://docs.convex.dev/functions/query-functions), [Queries that scale](https://stack.convex.dev/queries-that-scale))

**Phase note:** For the single-user MVP, ranking is **content-intrinsic** (quality rubric + diversity + anti-repetition + session adaptation). **Global/behavioral ranking and `CardAggregateStats` are dormant until there is a user base** — they cannot bootstrap from one user.

---

## Decision summary

| #   | Area         | Decision                                                                                | Status                             |
| --- | ------------ | --------------------------------------------------------------------------------------- | ---------------------------------- |
| 001 | Frontend     | SvelteKit + Svelte 5 + `convex-svelte` (SSR via `convexLoadPaginated`)                  | ✅ GO ⚠ prove SSR-to-live in spike |
| 002 | Backend      | Convex                                                                                  | ✅ GO                              |
| 003 | AI           | Vercel AI SDK v6 + Gateway, in Convex actions; gen ≠ validator model                    | ✅ GO                              |
| 004 | Auth         | Deferred; later Better Auth anonymous + Google + Apple only                             | ✅ GO (deferred) ⚠ test linking    |
| 005 | Source       | Wikimedia free tier, Action API + adapter; attribute, defer license, capture provenance | ✅ GO                              |
| 006 | Deploy       | Vercel (`adapter-vercel`)                                                               | ✅ GO                              |
| 007 | Feed compute | Precomputed candidate pools + light feed query; content-intrinsic ranking for MVP       | ✅ GO                              |
