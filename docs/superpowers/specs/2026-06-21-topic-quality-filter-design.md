# Topic Quality Filter — Design Spec

**Date:** 2026-06-21 · **Status:** Self-approved (autonomous) · **Follow-up to** Topics & Interests SP1–6

## Goal

Keep clearly-junk "topics" out of the catalog so onboarding suggestions, search, and generation only surface real subjects. The top-pageview harvest pulls in TLDs (`.xyz`, `.xxx`), "Deaths in 2026", "YYYY in film" ranking pages, etc. — noise for an interesting-facts feed.

## Decisions (YAGNI)

- **Conservative pattern filter, not a classifier.** Reject only clear junk by title shape; do NOT try to judge "interestingness" (that needs categories/embeddings — out of scope). Better to keep a few mediocre topics than nuke good ones.
- **Filter at the source (harvest) + purge existing.** Gate `harvestTopDay` with the predicate so new junk never enters, and a one-time `purgeLowQuality` cleans the current ~2.4k. The catalog stays the clean source of truth — `topByPageviews`/`search`/`needingCards` need no per-read filtering.
- Reject patterns (in `isQualityTopic`): TLD-like (`^\.[a-z]{2,}$`), "Deaths in …" (`^deaths? in`), "YYYY in …" ranking pages (`^\d{3,4}[ _]in[ _]`). Everything else (people, places, films, events, concepts) passes.

## Components

- `convex/topicsLogic.ts` (modify): add pure `isQualityTopic(title: string): boolean` (the three rejects above; case-insensitive; trims).
- `convex/topics.ts` (modify): `harvestTopDay` filters survivors by `isRealArticleTitle(a.article) && isQualityTopic(a.article)`.
- `convex/topics.ts` (add): `purgeLowQuality` (internalMutation) — scan `topics`, delete rows whose `title` fails `isQualityTopic`; return `{ deleted }`. (One-time op; ~2.4k rows fits one transaction. If the catalog were huge this would paginate — YAGNI now.)

## Testing

- Pure (`topicsLogic.test.ts`): `isQualityTopic` rejects `.xyz`/`.xxx`, "Deaths in 2026", "2026 in film"/"2008_in_music"; accepts "Cleopatra", "Cristiano Ronaldo", "Cape Verde", "2026 FIFA World Cup" (year-prefix events are NOT rejected), "ChatGPT".
- `convex-test` (`topics.test.ts`): `purgeLowQuality` deletes seeded junk rows, keeps quality rows, returns the count.
- **Data (human-like):** after deploy + purge, `topByPageviews` no longer returns TLDs/"Deaths in"; reload onboarding and confirm cleaner suggestions.

## Scope boundary

No category/embedding-based quality scoring; no UI changes; harvest/generation logic otherwise unchanged. The filter is title-shape only.

## Risks

- Pattern filter is coarse — some junk (e.g. "Disclosure Day", hyper-current events) still passes; acceptable (YAGNI, and they're not as jarring as TLDs). False-positive risk is low given the conservative patterns; the pure tests lock the accept-cases.
