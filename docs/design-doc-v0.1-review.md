# Review of Design Doc v0.1 — AI-Generated Knowledge Feed

**Reviewer pass:** technical verification + gap analysis before MVP
**Date:** 2026-06-15
**Verdict in one line:** The product thesis is sound and the stack is coherent and well-supported, but four things must be resolved *before* writing MVP code — (1) Wikipedia **text** licensing/ShareAlike, (2) the 2026 Wikimedia **rate-limit** regime, (3) a real **source-grounding / anti-hallucination** mechanism, and (4) a **cold-start** plan that doesn't depend on global stats that won't exist for a single user. Several stack claims are now outdated and a few open decisions can be closed today.

---

## 0. How to read this document

- **§1** — what the doc got right (so we don't relitigate it).
- **§2** — claims in the doc that research **corrected or updated**.
- **§3** — **blocking gaps** to resolve before MVP build.
- **§4** — **important (non-blocking) gaps**.
- **§5** — closing the open decisions in doc §24.
- **§6** — a revised, leaner build order for the actual first user.

Every external claim below is cited. Where the law is unsettled (CC BY-SA on AI output), that is flagged explicitly — get counsel, don't take this as legal advice.

---

## 1. What the doc gets right (keep as-is)

- **Core thesis** — "passive scrolling → passive knowledge acquisition, every card a fast reward, every interaction improves the next" is a clear, testable product bet.
- **One-idea-per-card + source-grounding principle** — correct framing; the failure mode ("chopped-up Wikipedia") is named accurately.
- **Anonymous-first auth** is a real, supported pattern (with caveats — see §2.3).
- **Stack coherence** — TanStack + Convex + Vercel AI Gateway + Wikimedia is a genuinely well-trodden, officially-supported path. Convex is a TanStack Start partner; `convexQuery` bridges Convex's reactive WebSocket model into TanStack Query with live updates and optimistic rollback. ([Convex TanStack docs](https://docs.convex.dev/client/tanstack/tanstack-query/), [TanStack partner page](https://tanstack.com/partners/convex))
- **Convex components exist and are real** — Rate Limiter, Workpool, Workflow, Migrations, Aggregate, Sharded Counter, R2, RAG, Agent, Better Auth are all official `get-convex` components. ([convex.dev/components](https://www.convex.dev/components))
- **Phased plan and the explicit "MVP fails if…" list** — good discipline; this review mostly pushes on making Phase 1 even smaller.
- **Separate Christian app** (shared engine, separate content/trust model) — correct call; don't mix verticals in v1.

---

## 2. Claims the research corrected or updated

### 2.1 Wikimedia rate limits — the doc is out of date and under-scoped *(HIGH)*

The doc says "Wikimedia API usage must follow user-agent, rate-limit, and content-license requirements" but treats this as a footnote. The 2026 reality is stricter:

- **Anonymous (IP-only) requests are now limited to ~10 requests/minute.** Authenticated low-edit accounts get ~200/min; established/bot accounts more. Limits track the account's *current* privileges. ([Wikimedia APIs/Rate limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits), [API Policy Update 2024](https://meta.wikimedia.org/wiki/Special:MyLanguage/API_Policy_Update_2024))
- A meaningful **User-Agent with contact info** is required; keep concurrent requests ≤ 3.
- For **high-volume / commercial / AI reuse**, WMF explicitly directs you to the **paid Wikimedia Enterprise API**; the free APIs are not meant to absorb bulk commercial load. ([Wikimedia Enterprise FAQ](https://meta.wikimedia.org/wiki/Wikimedia_Enterprise/FAQ))

**Why it matters:** ingestion is server-side and batchable, so for a single user this is *manageable* — but only if designed for it: register an account / use OAuth 2.0 to clear the anonymous tier, cache aggressively, prefer **dumps** for bulk seed, and keep an Enterprise path in mind for scale. A naive "fetch on demand, fan out anonymous requests" approach hits the ~10/min wall immediately.

### 2.2 Wikimedia content APIs — the doc cites endpoints that are deprecating *(MEDIUM)*

- The doc references `wikimedia.org/api/rest_v1` (Analytics) and `api.wikimedia.org`. **RESTBase (`/api/rest_v1/`) is being phased out** (per-wiki doc roots now redirect; `/page/related` already blocked), and the **Core REST API on `api.wikimedia.org` is scheduled for gradual deprecation July 2026 → June 2027.** ([API Portal/Deprecation](https://wikitech.wikimedia.org/wiki/API_Portal/Deprecation))
- The **MediaWiki Action API (`/w/api.php`)** is *not* deprecated and is the most complete/stable surface. It returns pageid + revid + categories + links + extracts in a single `action=query` call. **Use it as the durable backbone and isolate all source fetching behind an adapter** so endpoint churn is a one-file change.
- The pageviews "top articles" endpoint *does* exist (daily, or monthly via `day=all-days`; ~top-1000; no native weekly — aggregate yourself). It currently still lives on the legacy `rest_v1` host, so treat it as legacy too. ([Most read articles — API Portal](https://api.wikimedia.org/wiki/Most_read_articles))

### 2.3 Better Auth + Convex — official but **pre-1.0**, with relevant history *(MEDIUM)*

- It is an official Convex component (`@convex-dev/better-auth`), and the **Anonymous plugin is explicitly listed as supported**, no schema changes needed. Linking anonymous → permanent uses the `onLinkAccount({ anonymousUser, newUser })` callback. ([Convex+Better Auth supported plugins](https://labs.convex.dev/better-auth/supported-plugins), [Better Auth anonymous plugin](https://better-auth.com/docs/plugins/anonymous))
- **But:** latest is `0.12.3` (pre-1.0), with **breaking changes across 0.x minors** (published migration guides for 0.9, 0.10…) and **tight version pinning** — `0.12.3` requires `better-auth >=1.6.11 <1.7.0`. You cannot bump Better Auth independently. ([component repo](https://github.com/get-convex/better-auth))
- There was a **critical anonymous-on-Convex bug** (newly-created anonymous users deleted mid-request) — [issue #5824](https://github.com/better-auth/better-auth/issues/5824), now **closed/fixed**, with `disableDeleteAnonymousUser: true` as the mitigation. Verify the linking/data-migration flow yourself; no Convex-specific `onLinkAccount` example is published.

**Implication:** anonymous-first is viable but rests on a young, fast-moving dependency on a path that was broken months ago. See §3.4 for the recommendation to *defer* Better Auth out of Phase 1 entirely.

### 2.4 Vercel AI Gateway — resolves an open question in our favor

- **GA since Aug 2025, pass-through pricing (zero token markup, incl. BYOK)**, with fallbacks, load balancing, budgets/spend caps, observability. ([AI Gateway docs](https://vercel.com/docs/ai-gateway))
- **It supports embeddings** (dedicated `/embeddings` endpoint; OpenAI `text-embedding-3-*`, Cohere `embed-v4.0`, Voyage, Google). This **closes doc §24 open-question #8 / the §14.3 "if supported" hedge** — yes, embeddings route through the same Gateway key. ([Gateway embeddings](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/embeddings))
- AI SDK is at **v6** (GA Dec 2025), with `generateObject` (Zod structured output) and `embed`/`embedMany`. ([AI SDK 6](https://vercel.com/blog/ai-sdk-6))

### 2.5 TanStack Start is still a **Release Candidate**, not 1.0 *(decide now, don't defer)*

- Start's v1 RC landed Sept 2025; as of mid-2026 it is **API-stable but still RC, not a cut 1.0.** It deploys on Vercel via Nitro/Fluid Compute. ([Start v1 RC](https://tanstack.com/blog/announcing-tanstack-start-v1), [Start on Vercel](https://vercel.com/docs/frameworks/full-stack/tanstack-start))
- The doc defers the Router+Vite-vs-Start decision. Because the doc *itself* anticipates SSR share pages (social unfurls, future Christian-app public pages), and retrofitting SSR onto an SPA is costly, **make this call now** — see §5.

---

## 3. Blocking gaps — resolve before MVP build

### 3.1 Wikipedia **text** licensing & ShareAlike — the biggest under-addressed risk *(HIGH / legal)*

The doc's source-record model (§8.3) and image model (§8.4) carefully handle **image** attribution but say almost nothing about **text** licensing — yet the entire product is AI-rewritten Wikipedia text.

- English Wikipedia article text is **CC BY-SA 4.0** (per Terms of Use §7). Commercial use is allowed, but **both attribution *and* ShareAlike apply.** ([WMF Terms of Use](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/legalcode))
- **The hard part:** if an AI card is a *derivative/adaptation* of a specific article (close summarization/rewriting generally is), ShareAlike implies the **card itself must be licensed CC BY-SA 4.0**, carry **attribution to the source article + authors**, and **note that it was modified.** This is a copyleft obligation on user-facing content, not just a backend metadata concern.
- The "facts aren't copyrightable, so a fact-summary isn't a derivative" defense is real but **fact-specific and legally unsettled for AI rewrites** — don't build the business on it without counsel.
- WMF shipped a **Wikimedia Attribution Framework + Attribution API (Beta, May 2026)** that gives structured per-article/file attribution data and is the recommended pattern for AI/commercial reusers. **Adopt it** to make compliance turnkey. ([Attribution Framework announcement](https://diff.wikimedia.org/2026/05/18/a-better-way-to-give-credit-introducing-the-wikimedia-attribution-framework-and-api/))

**Action before MVP:**
1. Decide the card-licensing posture (most defensible: cards carry visible attribution + "adapted from Wikipedia, modified" + a CC BY-SA notice). Get a lawyer to confirm before any external launch.
2. Add **text** license/attribution fields to the `SourceArticle`/`KnowledgeCard` model (author list or stable article URL, revision, "modified" flag) — co-equal with the image fields. The doc's own MVP-failure list says "the source/attribution model is bolted on later" — this is exactly that risk for text.

### 3.2 Source-grounding / anti-hallucination is the core risk and is hand-waved *(HIGH)*

Pipeline step 10 "Validate source support" (§9.1) and the "AI is not the source of truth" principle (§3.3) are the make-or-break of the whole trust proposition — but there's **no mechanism.** This is the single most important thing to prototype, because a feed of confident-but-wrong "facts" is worse than no product.

Specific dangers the doc under-weights:
- **Myth-buster and "timeline shock" formats are the most hallucination-prone** and the doc even lists "false myth-busting" as a risk in §21.2 — with no countermeasure. (The doc's own example, "Napoleon wasn't short," is itself a contested simplification.) Consider gating these formats behind stricter validation or excluding them from the very first cut.
- Wikipedia itself contains errors and nuance; an AI confidently flattening a hedged passage into a punchy claim is a failure mode even when "grounded."

**Action before MVP — make validation concrete:**
- Require each card to store the **exact source span** it was generated from (doc §24 #12 — choose "store exact spans," not "section reference"). You cannot validate grounding against a whole section.
- Add an explicit **claim-support check**: a second LLM pass (or NLI/entailment check) that verifies the hook+body are entailed by the stored span, returning a support score; below threshold → `validation_failed`. AI SDK `generateObject` makes this a structured call. The Convex **RAG component** is a natural fit for retrieval here.
- **Keep humans in the loop for v1.** Doc §9.4 allows auto-publish "for early development." Given the trust stakes and that the only user is the founder, run a **manual approve queue from day one** — it's the cheapest possible quality bar and generates the labeled data you'll need to trust automation later.

### 3.3 Cold-start contradiction — the ranking design assumes data that won't exist *(HIGH for MVP)*

The ranking philosophy (§7.3, §16.2) and metrics (§23, `CardAggregateStats`) lean heavily on **"global high performers"** and behavioral aggregates. But the **first (and for a while, only) user is Leland.** There is no population, so there are no global performers and no aggregate stats to bootstrap from. The "start with a global hot feed and personalize silently" mechanic (§7.2) **is circular for a single-user launch.**

**Action before MVP:** Phase 1 ranking must be **content-intrinsic**, not behavioral:
- Rank by the **quality rubric scores** (§10.3) + a diversity/novelty spread + format variety + simple anti-repetition. No global stats required.
- Treat the §7.3 learned/behavioral ranking and `CardAggregateStats` as **Phase 3+**, explicitly. Make the doc say "global behavioral ranking is dormant until there is a user base; single-user ranking is quality + diversity + session adaptation."

### 3.4 Architecture mismatch: Convex can't do the feed the way the doc implies *(HIGH)*

The doc describes feed ranking as if it's a reactive query joining profile + candidates + embeddings + randomness (§16). Convex's execution model makes parts of that infeasible as written:

- **Vector search runs only in actions, not in queries**, is capped at indexing the **first 100k documents** per index, returns ≤256 results, and supports ≤16 filter fields, 2–4096 dims. ([Convex vector search](https://docs.convex.dev/search/vector-search))
- **Queries are deterministic and cached**, and a query **re-runs whenever any document it read changes.** A query that reads hundreds of candidate cards carrying volatile counters (impressions/saves) will be invalidated constantly ("reactivity amplification"). ([Convex queries](https://docs.convex.dev/functions/query-functions), [Queries that scale](https://stack.convex.dev/queries-that-scale))
- **`Math.random()`/`Date.now()` inside a query break the subscription/determinism model.** Randomness (wildcards, shuffles) must come from a **client-supplied seed arg** or a **stored random field**, not live RNG.
- Hard per-transaction limits: ~32k docs scanned, 16 MiB read, 1s CPU. "Score every card" = a scan that will eventually hard-fail.

**Action before MVP — adopt the right pattern:**
- **Precompute candidate pools** in a scheduled action/mutation (embeddings + global scores live here, in actions). The **feed query reads a small, indexed, materialized candidate set** and does only light per-request scoring/ordering.
- **Segregate volatile counters** (impressions/saves/skips) into separate documents (or the Aggregate/Sharded Counter components) so the feed query doesn't subscribe to them.
- **Inject randomness via a session seed argument**, not in-query RNG.
- For a single user this is overkill at first — but bake the candidate-pool boundary in early so Phase 3 doesn't require a rewrite.

---

## 4. Important (non-blocking) gaps

### 4.1 Massive over-engineering for a one-user MVP *(scope)*
The doc specifies ~20 entities, a concept graph with 9 edge types, ranking experiments, 10 quality sub-scores, fatigue/novelty vectors, etc. — for a Phase-1 success criterion that is literally *"Leland voluntarily scrolls a meaningful number of cards."* The risk: building a recommendation cathedral before validating that the cards are fun.
- **Recommendation:** Phase 0 = hand-curate/generate **100–200 cards** (even semi-manually) and test addictiveness with *no* personalization, *no* graph, *no* auth. If the cards aren't compelling flat, no ranking engine will save them. The doc's own MVP-failure list ("accurate but boring") is the real risk to retire first.
- Defer `Concept`, `ConceptEdge`, `CardConcept`, `UserConceptWeight`, `RankingExperiment`, `CardAggregateStats` until Phase 3+.

### 4.2 "Maximize addiction" as the north star is a liability *(positioning)*
The explicit objective ("Maximize addiction / one-more-scroll") is in direct tension with §21's quality guardrails and the "better than TikTok" pitch, and reads poorly for app-store review, press, and the founder's own stated values. The behavior you want — "that was worth it, show me another" — is better framed as **session quality / curiosity continuation**, which the doc already has a metric for (CCR). Recommend reframing the north star to CCR explicitly and dropping "addiction" as the stated goal. Same engine, defensible framing.

### 4.3 The north-star metric (CCR) isn't operationalized *(measurement)*
"Curiosity Continuation Rate" needs concrete definitions before it can be logged: what dwell threshold counts as "meaningful" per card length? Is a fast skip a non-continuation? Define the event math (it depends on `card_visible_ms` normalized by body length) in the event schema, or it can't be computed. Also: with one user, CCR is noisy — treat early numbers as directional only.

### 4.4 No cost model *(planning)*
Generation + validation + embeddings per card, plus **regeneration on every prompt-version change** (§9.3), has a real cost. Gateway pricing is pass-through (good), but estimate $/1000 cards across the generate→validate→embed pipeline so the seed-library size in §24 #11 is a budget decision, not a guess.

### 4.5 Content freshness / revision drift *(later)*
Cards pin a `revisionId`, but Wikipedia edits continuously. There's no re-validation trigger when the source revision changes. Fine to defer, but note it: a card can silently drift from its source. A periodic "source changed → re-validate" job belongs in the roadmap.

### 4.6 Image pipeline must fail closed on license ambiguity *(compliance detail)*
Pull images from **`commons.wikimedia.org` only** (Commons forbids fair-use; en.wikipedia hosts non-free files). Parse `imageinfo`→`extmetadata`, **exclude any `NonFree=true` or missing/incompatible license**, prefer `LicenseShortName`+`LicenseUrl`, honor `AttributionRequired`, and **skip the image when license data is ambiguous** (CommonsMetadata's own `License` best-guess is documented as unreliable). ([API:Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo), [Extension:CommonsMetadata](https://www.mediawiki.org/wiki/Extension:CommonsMetadata), [Commons:Licensing](https://commons.wikimedia.org/wiki/Commons:Licensing))

### 4.7 Privacy/legal basics absent *(pre-external-users)*
The doc's account model (§20) covers UX but not: a privacy policy, data-retention/rollup policy (it mentions rolling up events but no schedule), GDPR/CCPA delete (the `delete account` control needs a real cascade across events/impressions), and the fact that "addiction-optimized feed for an anonymous user" invites scrutiny. Not a Phase-1 blocker for a single founder-user, but must precede any external user.

---

## 5. Closing the open decisions (doc §24)

| # | Decision | Recommendation | Basis |
|---|----------|----------------|-------|
| 1 | Router+Vite vs Start | **TanStack Start (pin exact version)** | Doc anticipates SSR share pages; Start is API-stable RC; Convex+Start+Vercel is officially supported. Retrofitting SSR later is costly. If risk-averse about RC, Router+Vite + a tiny serverless OG-render route is the fallback. |
| 4 | Seed window | **Monthly top + a curated allowlist**, not daily | Monthly is calmer/less news-driven; daily top is full of current events the doc wants to suppress anyway. |
| 5 | Exclusion categories | Start with the doc's §8.2 suppress-list **as a hard filter on ingestion**, plus living-person/BLP caution | Cheaper to exclude at ingest than to suppress at rank time. |
| 6/7 | Generation + validation models | Two **different** models via Gateway (a strong generator; a separate validator/judge) | Using the same model to write and grade its own claims is weak; cross-model validation is more honest. Gateway makes swapping trivial. |
| 8 | Embedding model | **Resolved: yes, via Gateway** (`text-embedding-3-small` to start) | §2.4 |
| 9 | Admin review before Leland's feed | **Yes — manual approve queue from day one** | §3.2; cheapest quality bar, generates training labels. |
| 10 | Interest onboarding | **None in v1** (as doc says) — but consider a 1-tap "pick 3 sparks" *optional* card to soften single-user cold start | Mitigates §3.3 without friction. |
| 11 | Cards before first test | **~150–200 curated/generated cards** | Enough for a few real sessions without over-investing pre-validation (§4.1). |
| 12 | Store spans vs section ref | **Store exact source spans** | Required for grounding validation (§3.2). |
| — | Auth in Phase 1 | **Defer Better Auth; use a local/device id first** | §3.4/§2.3 — Better Auth Convex is pre-1.0 with a recently-broken anonymous path; a single user doesn't need it until account-linking (Phase 5) matters. |

---

## 6. Suggested leaner build order (replacing doc §25 for the *actual* first user)

0. **Card-quality spike (no infra):** generate/curate ~150 cards, render them in a dead-simple vertical feed, and have Leland scroll. Decide: are these fun? *(Retires the #1 risk before any backend.)*
1. Feed shell (TanStack Start) + local device id (no auth yet) + static card store in Convex.
2. Event logging (impression, dwell, complete, skip, save, expand) — batched, non-blocking — with **CCR math defined**.
3. Content-intrinsic ranking (quality + diversity + anti-repetition + session adaptation). **No global stats.**
4. Ingestion behind a **source-adapter** (Action API; account/OAuth for rate limits; dumps for bulk) → article/section/image models with **text + image license fields** and **exact source spans**.
5. Generation pipeline (Workpool/Workflow) → **validator pass (separate model) + RAG grounding** → **manual approve queue**.
6. Only now: concepts, embeddings (precomputed in actions), candidate-pool materialization, adjacency/wildcards.
7. Aggregate stats + experiments + behavioral ranking — once there's a user base.
8. Better Auth + account linking when "save across devices" becomes real.

---

## 7. The four things to settle this week

1. **Legal posture on Wikipedia text** (attribution + ShareAlike on AI cards). Talk to counsel; add text-license fields to the schema now.
2. **Rate-limit / ingestion strategy** (authenticated requests + caching + dumps; Enterprise as scale escape hatch).
3. **Grounding/validation mechanism** (exact spans + cross-model entailment check + manual approve queue).
4. **Cold-start ranking** that needs no global data, and the **Router-vs-Start** + **defer-auth** calls.

Everything else in the doc is good enough to start building against once these are nailed.
