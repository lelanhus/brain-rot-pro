# Monetization — Affiliate "Go deeper" slots (ADR-008 + implementation plan)

**Status:** proposed (not yet built). Authored 2026-06-17.
**Depends on / respects:** ADR-005 (provenance), ADR-007 (light feed query), engineering-standards §1 (fail-fast), ui-ux.md (card feel).
**Goal:** a monetization path that works **before** we have an audience or a sales motion — i.e. requires no advertiser relationship and no scale to start.

---

## ADR-008 — Monetize via contextual affiliate slots first; reuse the same slot for direct sponsors later ✅ GO (proposed)

**Decision:** Introduce a single **sponsored slot** in the feed, filled in v1 by **self-serve affiliate offers** (Amazon Associates, Bookshop.org, course platforms) matched **contextually** to the surrounding cards' `conceptTags`. Each slot is a clearly-labeled "Go deeper" card with an outbound affiliate link. The same slot mechanism is later filled by **direct sponsors** with zero rework. Defer programmatic display networks (AdSense/AdMob) until DAU makes them meaningful; never use interstitials.

**Why:**

- **No counterparty, no scale required.** Affiliate programs are self-serve and live in a day; one user clicking through earns revenue. Direct sponsors need an audience + sales we don't have yet (this is the explicit blocker we're routing around).
- **Trust-preserving by construction.** Every offer is real, topical further-reading ("here's a book on Roman engineering" on a Roman-aqueduct card), labeled, and contextual — additive to a _learning_ product rather than parasitic.
- **Reuses what we already have.** Cards carry `conceptTags`; matching is a pure function. The feed already weaves non-organic items in (`weaveFeed`), so injection is an additive, deterministic step — not a rewrite.
- **Contextual, not behavioral.** Matching uses the card's topic, not a user profile, so it fits the anonymous device-id model (ADR-004) and keeps the clean, low-consent-burden privacy story.

**Why NOT (rejected alternatives):**

- **Programmatic display now** — CPMs are pennies at low volume, the good native networks gate at ~50k sessions/mo, and it degrades the premium feel for almost no money. Later-stage lever, not a "before sponsors" play.
- **Affiliate offers as `knowledgeCards` rows** — violates ADR-005: every `knowledgeCards` row MUST trace to a Wikipedia source span. Affiliate offers have no such provenance and a different lifecycle. They get their **own table**.
- **Injecting offers into `feed.personal` ranking** — violates ADR-007 (feed query stays light, reads the precomputed profile only). Injection happens at the client weave layer, deterministically, so it never pollutes personalization or invalidates the reactive query.

**Compliance (non-negotiable):**

- **FTC disclosure:** every slot is visibly labeled (e.g. "Sponsored · Go deeper") — not disguised as an organic card.
- Outbound links use `rel="sponsored nofollow noopener noreferrer"` and `target="_blank"`.
- Amazon Associates requires the program's standard disclosure string somewhere visible; Bookshop/others similar. Capture the required disclosure per network in the offer record so it renders with the slot.

**Caveats / validate-on-adoption:**

- ⚠ Amazon Associates terminates accounts with **zero qualifying sales in the first 180 days** — don't enable it until there's enough traffic to convert, or lead with Bookshop.org/course programs that have no such clause.
- ⚠ Some affiliate programs forbid link cloaking/redirects — confirm before adding a redirect endpoint; the deterministic outbound link is safest.

---

## Implementation plan

### 1. Data model (`convex/schema.ts`)

New table — **not** a field on `knowledgeCards`:

```ts
affiliateOffers: defineTable({
  // Rendered content (mirrors a card's shape so it can reuse Card styling).
  headline: v.string(),          // e.g. "Engineering an Empire"
  blurb: v.string(),             // 1 sentence, honest, ~20–30 words
  imageUrl: v.optional(v.string()),
  cta: v.string(),               // button label, e.g. "View on Bookshop"
  url: v.string(),               // affiliate deep link (tag/params baked in)
  network: v.union(              // for per-network disclosure + reporting
    v.literal('amazon'),
    v.literal('bookshop'),
    v.literal('course'),
    v.literal('direct')          // ← future direct sponsors use the same table
  ),
  disclosure: v.string(),        // network-required disclosure text shown with slot
  // Contextual targeting: overlap against surrounding cards' conceptTags.
  conceptTags: v.array(v.string()),
  weight: v.number(),            // manual priority / tie-break
  status: v.union(v.literal('active'), v.literal('paused')),
  createdAt: v.number()
}).index('by_status', ['status'])
```

Extend `eventType` for measurement (reuses the existing `events` table):

```ts
// add to the eventType union:
v.literal('sponsored_impression'),
v.literal('sponsored_click')
```

`events.cardId` is typed `v.id('knowledgeCards')`, so add a sibling field rather than overloading it:

```ts
// in the events table definition:
offerId: v.optional(v.id('affiliateOffers')),
```

### 2. Matching — pure, testable logic (`convex/affiliateLogic.ts`)

Following the `*Logic.ts` convention (pure, unit-tested without a deployment, per engineering-standards §3):

```ts
// Pick the best active offer for a given set of nearby concept tags.
// Score = tag overlap + weight; deterministic tie-break by _id. Returns null
// if nothing overlaps (we DO NOT show an irrelevant offer — quality bar).
export function pickOffer(
  offers: AffiliateOffer[],
  nearbyTags: string[],
  opts: { minOverlap?: number }
): AffiliateOffer | null { /* ... */ }
```

Quality rule baked in: **no overlap → no slot.** Better an empty slot than an irrelevant ad.

### 3. Serving query (`convex/affiliate.ts`)

A light query (ADR-007 compliant — reads only the small `affiliateOffers` table, never events/profile):

```ts
export const active = query({
  args: {},
  returns: /* array validator */,
  handler: async (ctx) =>
    ctx.db.query('affiliateOffers')
      .withIndex('by_status', (q) => q.eq('status', 'active'))
      .collect()
});
```

The client matches per-slot against nearby cards' tags so the feed query stays untouched.

### 4. Injection — deterministic, never interrupts a rabbit hole (`src/lib/feed.ts`)

New pure sibling to `weaveFeed`, applied to the **base** feed _before_ weaving (so "more like this" runs stay 100% organic — the guardrail from the monetization discussion):

```ts
// Insert a sponsored slot after every `cadence`-th base card, choosing the
// best contextual offer from the surrounding window. Deterministic given the
// same inputs (no in-render RNG — mirrors ADR-007's shuffleKey discipline).
export function injectSponsored(
  base: readonly Doc<'knowledgeCards'>[],
  offers: readonly AffiliateOffer[],
  opts: { cadence: number; seed: string }
): FeedItem[] { /* ... */ }
```

`FeedItem` becomes a discriminated union: `{ kind: 'card'; card } | { kind: 'offer'; offer }`. Cadence default **1 per 10**, frequency-capped per session.

Wire-in at `src/routes/+page.svelte:67` — `visibleResults` gains the offers query and runs `injectSponsored` on the base before `weaveFeed`.

### 5. Rendering (`src/lib/components/SponsoredCard.svelte`)

A sibling to `Card.svelte` that reuses the same `.card` / `.card-body` styles for visual nativeness, but is **unmistakably labeled** and has no save/dismiss-into-profile semantics:

- Tag reads **"Sponsored · Go deeper"** (distinct color from `formatName` tags).
- `headline` → `.hook`, `blurb` → `.body`, optional `imageUrl` → `.card-image`.
- CTA button → outbound link, `rel="sponsored nofollow noopener noreferrer" target="_blank"`, fires `sponsored_click`.
- `disclosure` rendered small beneath the CTA.
- An IntersectionObserver (reuse the `dwell` action pattern) fires `sponsored_impression` once when ≥50% visible.
- A "Not interested" affordance that suppresses _that offer/network_ for the session (respects the same dismissal contract organic cards have).

`+page.svelte`'s `{#each}` switches on `item.kind` to render `Card` or `SponsoredCard`.

### 6. Tracking & reporting

- Impressions/clicks land in `events` with `offerId`, reusing the existing telemetry batch/flush (`src/lib/telemetry.ts`).
- A simple Convex query aggregates CTR per offer/network — this is also the dataset that later lets us _price_ direct sponsors credibly.

### 7. Curation

v1: offers are **seeded manually** (a `convex/seed`-style script or a tiny `/admin/offers` route mirroring `/review`). No self-serve advertiser UI yet — that's a later phase once volume justifies it.

---

## Phasing

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| **A — affiliate MVP** | schema + `affiliateLogic` + `injectSponsored` + `SponsoredCard` + manual offers + tracking | a labeled, contextual affiliate slot renders at 1/10 cadence; impression/click events recorded; `npm run verify` green |
| **B — measure & tune** | CTR reporting query, per-session frequency cap, per-network disclosure correctness, "not interested" suppression | real CTR numbers; cadence tuned against retention; no measurable hit to session length |
| **C — reuse slot for direct/programmatic** | `network: 'direct'` offers sold by hand using Phase-B numbers; evaluate a native in-feed network only if DAU justifies | first direct sponsor live through the existing slot with zero new UI |

## Testing (engineering-standards §3)

- `affiliateLogic.pickOffer` and `injectSponsored` are **pure** → unit tests (no overlap → null; cadence positions exact; rabbit-hole runs never receive an offer; deterministic ordering).
- `convex/affiliate.active` → convex-test (status filter).
- `SponsoredCard.svelte` → component test (label present, `rel="sponsored"` set, click fires `sponsored_click`).
- All offline; folds into the existing `npm run verify` gate.

## Open questions for the owner

1. **Which networks first?** Recommend leading with **Bookshop.org + a course program** (no 180-day-sale termination clause); add Amazon once traffic converts.
2. **Cadence comfort:** start at **1 per 10** organic cards, session-capped — agree before building?
3. **Suppression scope:** should "not interested" on an offer hide the network for the session, permanently (needs the profile/account work), or just that offer?
