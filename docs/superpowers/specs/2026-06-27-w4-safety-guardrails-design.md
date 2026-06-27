# W4 — Safety Guardrails — Design

**Date:** 2026-06-27
**Workstream:** W4 (Safety guardrails) of the public-launch program.
**Status:** Approved, ready for implementation planning.

## Context

The feed auto-publishes AI-generated cards with **no human in the loop**, so a
sensitive article can reach it. The existing filters (`wikidataLogic.ts`
BLOCK_CLASSES/OCCUPATIONS, `isEvergreenArticle`, `isEphemeral`) target
**evergreen-ness** (drop sports/entertainment/current-events noise), not
**safety**. Today safety is only a prompt nudge (`generateLogic.ts`) + reactive
admin suppress. This adds the missing guardrails the release gate requires
(`acceptance-criteria.md:114`): enforced at **ingestion** and at **rank time**,
for medical / legal / active-politics / harm.

## Decisions (locked)

- **Posture: targeted.** Block CURRENT/ongoing controversy and always-harmful
  content; KEEP evergreen science/history even when the abstract topic is
  "medical" or "political". The classifier must not gut legitimate Wikipedia
  knowledge (anatomy, historical wars, historical politics stay).
- **Mechanism (approach A):** a pure, deterministic `classifySafety()` over data
  ingest already fetches (article **categories** + **title** + the current year),
  consistent with the existing `wikidataLogic` pattern. No LLM call. Tunable via
  keyword lists.
- **Defense in depth, minimally:** fold the safety check into the single ingest
  chokepoint (`decideArticleStatus`) and add a re-classification **backfill** for
  already-published cards. **No separate publish-time guard** — generation only
  consumes `fetched` (safety-cleared) articles, so it would be redundant.
- **Rank-time = structural.** The feed serves only `status: 'published'`
  (`feed.ts:55`, `cards.ts:26`). Because nothing unsafe ever becomes or stays
  `published`, the served feed is clean by construction — no per-query filter.
- **Defer** a content-level safety check on generated card text (the prompt
  forbids sensationalism, the validator scores support, topic-suppress + backfill
  cover the main risk). Add later only if real misses appear.

## `classifySafety` — the classifier

```
classifySafety(args: { categories: string[]; title: string; nowYear?: number })
  → { safe: boolean; reason?: SafetyReason }
type SafetyReason = 'harm' | 'active-politics' | 'ongoing-legal'
                  | 'recent-tragedy' | 'medical-advice'
```

Pure, case-insensitive matching over `categories` (and `title` as a weak signal).
Two block sets:

1. **Always-harmful** (`'harm'`, regardless of recency): self-harm/suicide,
   explicit/sexual abuse, hate/extremism/terrorism, graphic-violence how-to.
2. **Current/advice-sensitive** (only the _current_, never the _evergreen_):
   - `'active-politics'` — elections, current officeholders, political
     scandals/controversies, "ongoing".
   - `'ongoing-legal'` — pending/ongoing litigation, current court cases.
   - `'recent-tragedy'` — year-stamped tragedy/death/disaster/outbreak categories
     within the **current or prior year** (`nowYear`/`nowYear-1`), e.g. "Deaths in
     2026", "2026 … disasters", current "pandemic"/"disease outbreaks".
   - `'medical-advice'` — advice-framed health: medications, treatments,
     therapies, mental-health crises. **Kept:** anatomy, biology, descriptive
     historical medicine.

When `nowYear` is absent, the recency-dependent checks are skipped (always-harmful
and advice rules still fire) — so the classifier is robust at any call site.

Keyword lists are exported constants, tuned against live ingest data during
implementation (the existing `decisions` log surfaces every verdict for tuning).

## Enforcement points

1. **Ingest** — in `decideArticleStatus` (`wikidataLogic.ts:157`), run
   `classifySafety` **first** (safety wins over allow/block/ephemeral, like block
   wins over allow). Unsafe → `{ status: 'filtered_out', basis: 'safety: <reason>' }`.
   Both ingest call sites (`ingest.ts:323`, `:368`) inherit it; the per-title
   `decisions` log records the safety verdict for free. A `filtered_out` article is
   never `fetched`, so it is never generated → no generation cost, never published.
2. **Backfill** — `convex/safety.ts` `backfillSafety` internalAction: page over
   `published` cards, re-classify via the linked source article
   (`card.generation.sourceArticleId` → `sourceArticles.categories`, plus
   `card.source.articleTitle`); unsafe → flip to `suppressed` (reuse
   `curation.suppressCards`). Closes the already-live gap. Cards without a
   `generation` link (hand-seeded, pre-vetted) classify on title/tags only.
3. **Rank time** — no code: the existing `published`-only feed query is the
   enforcement, now clean by construction.

## Files

- **New** `convex/safetyLogic.ts` — `classifySafety` + exported keyword sets +
  `SafetyReason`. Pure.
- **New** `convex/safetyLogic.test.ts` — the classification matrix.
- **Modify** `convex/wikidataLogic.ts` — `decideArticleStatus` runs the safety
  pre-check first; imports from `safetyLogic`.
- **New** `convex/safety.ts` — `backfillSafety` internalAction (+ any internal
  query it needs to page cards/join the source article).
- **Modify** `docs/release-gates.md` — record the safety gate as addressed.

No schema change (reuses `status: 'filtered_out'` on articles and `'suppressed'`
on cards).

## Error handling / edge cases

- **False positives are the main risk** (over-blocking legitimate science/history).
  The targeted lists bias toward _current/advice_ keywords, not whole domains;
  the `decisions` log makes over-blocks visible for tuning. Bias: when uncertain,
  the classifier returns `safe` (the evergreen/Wikidata filters already cull
  non-knowledge content; safety only adds the harmful/current layer).
- **Backfill is idempotent and reversible** — re-running only flips unsafe→
  suppressed; suppressed cards can be restored if a list is over-broad.
- `classifySafety` never throws; empty categories + title → `safe`.

## Testing

- **Unit** (`convex/safetyLogic.test.ts`): the matrix — evergreen kept (anatomy,
  WWII, Roman politics); blocked (a 2026 election, "Deaths in 2026", a suicide
  category, a medication); the recency boundary (a 2010 disaster kept vs a
  `nowYear` disaster blocked); `nowYear`-absent degrades safely.
- **Integration** (convex-test): `decideArticleStatus` returns `filtered_out`
  with a `safety:` basis for an unsafe article and `fetched` for an evergreen one;
  `backfillSafety` suppresses a seeded unsafe published card and leaves safe ones.
- `bun run verify` green (typecheck + lint + unit + convex + component).
- **Live validation** is deploy-gated (held per the user) — run the backfill on
  the dev deployment when deploys resume, and spot-check the `decisions` log.

## Out of scope

- LLM/content-level safety classifier on generated text (deferred).
- Admin moderation UI for safety (tracked separately; the `decisions` log +
  existing suppress are enough for launch).
- Schema changes / a dedicated `sensitive` flag (the `suppressed` status suffices).

## Launch program (context)

| #               | Workstream                         | Status        |
| --------------- | ---------------------------------- | ------------- |
| W1              | Rebrand → Wonderwell               | done (live)   |
| W2              | Domain + deployment + admin-auth   | pending       |
| W3              | Privacy & legal                    | pending       |
| **W4**          | **Safety guardrails**              | **this spec** |
| W5              | Security hardening — rate limiting | done (live)   |
| W6              | Error tracking + resilience        | pending       |
| (toast cleanup) | —                                  | done (live)   |
| (new)           | Image rehosting → R2 + Migrations  | pending       |
