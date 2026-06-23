# Short Hooks at Generation + Backfill — Design Spec

**Date:** 2026-06-23 · **Status:** Approved · **Direction:** content & feel (hook length, sub-project 3)

## Goal

The hook is the card's poster headline, intended to land in **2–3 punchy lines** at the ~22ch measure (`app.css` `.hook`, `ui-ux.md`). But the generator's hook schema allows **up to 180 characters** with no length guidance in the prompt — so the model produces 130–180-char hooks that run **5–6 lines**. A live run confirmed this on essentially every card. Combined with the one-screen-fit work (sub-project 2), the over-long hook eats the viewport and pushes the body entirely behind "Read more," so the _fact itself_ is rarely visible without a tap.

Make generated hooks short (**~80 chars / 2–3 lines**, hard ceiling ~90) so the hook reads as a poster and the body shows by default, and backfill the ~142 already-published long-hook cards (which never self-regenerate).

This is sub-project 3 of "content & feel." Scope: hook length only.

## Root cause

`generateLogic.ts`: `hook: z.string().min(8).max(180)` with describe "One scroll-stopping sentence; declarative, not clickbait" — no length budget. `buildGenerationPrompt` has rules for body brevity but none for the hook. So nothing constrains hook length below 180 chars (~8 lines at the hook measure).

## Decisions (YAGNI)

- **Target ~80 chars / 2–3 lines; hard ceiling `HOOK_MAX_CHARS = 90`.** New const in `generateLogic.ts`, mirroring the existing `BODY_MAX_CHARS = 480` pattern (single source of truth).
- **Enforce by generating short, not by truncating.** A hook is one complete sentence — trimming it would break it (unlike the body, which `clampBody` trims at a sentence boundary). So: schema `.max(HOOK_MAX_CHARS)` as the hard ceiling + an explicit prompt rule for one short line. An occasional model overrun fails schema validation and the existing pipeline retries / records `validation_failed` — better no card than a long one.
- **Backfill by reusing the proven regenerate flow — no new LLM pipeline.** The existing `generate.backfillShortenOverlong` already suppresses an oversized published card and regenerates a fresh one from its source article via `generateFromArticle` (which now produces a short hook), going through the same auto-publish bar (grounded + cross-model validated ≥ threshold) and re-embedding. Extend its work-list (`generateDb.overlongPublished`) to also match over-long _hooks_, and pass a `hookCap`.
- **Regeneration may surface a different fact/angle** than the original long-hook card (the existing body backfill already behaves this way — it uses `avoidHooks` and picks the best-supported paragraph). Accepted; preserving the exact original fact would require a separate hook-only LLM pipeline (rejected as more work for little gain).
- **Lossless:** the backfill suppresses an original only while regenerating (so the fresh card isn't deduped against it), and **restores it to `published` if no valid short replacement is produced** (validation_failed / duplicate / error). Hand-seeded cards (no source article) are skipped entirely. So a card is removed only when a real short replacement takes its place. (This improves on the existing body backfill, which left such cards suppressed.)
- **CSS line-clamp:5 stays** (sub-project 2's safety net); capped hooks never reach it. Out of scope.

## Components

- `convex/generateLogic.ts`:
  - Add `export const HOOK_MAX_CHARS = 90;`
  - `generatedCardSchema.hook`: `.max(180)` → `.max(HOOK_MAX_CHARS)`; update `.describe()` to state the one-short-line intent.
  - `buildGenerationPrompt`: add a rule line, e.g. `- The hook is ONE short line — at most ~80 characters (~12 words). A poster headline, not a sentence of context.`
- `convex/generateDb.ts` (`overlongPublished`):
  - Add `hookCap: v.number()` to args; change the filter to `c.body.length > cap || c.hook.length > hookCap`. (The returned row shape already includes `hook` and the source `articleId` — used by the backfill.) Adding a required arg breaks the existing `overlongPublished({ cap, limit })` callers — update both: the call in `backfillShortenOverlong` and the existing test in `generateDb.test.ts`.
- `convex/generate.ts` (`backfillShortenOverlong`):
  - Add `hookCap: v.optional(v.number())` (default `HOOK_MAX_CHARS`); pass it through to `overlongPublished`. The rest of the suppress→regenerate→publish loop is unchanged.
- No schema (DB) change, no UI change.

## Data flow

```
Forward (new cards):
  generateFromArticle → generateObject(generatedCardSchema {hook ≤90})
    + buildGenerationPrompt (hook = one short line)  → short hook → validate → publish

Backfill (existing, run via `npx convex run`):
  backfillShortenOverlong({cap, hookCap, limit})
    → overlongPublished(body.length>cap OR hook.length>hookCap)
    → for each: setCardStatus(suppressed) → generateFromArticle(articleId)
       → fresh short-hook card → validate ≥ threshold → published + embedded
       (restore the original to published if regeneration doesn't publish — lossless)
    → report { scanned, regenerated, keptUnchanged, errored }
```

## Error handling / edge cases

- Model returns a hook > 90: schema validation fails; existing pipeline retries / marks `validation_failed` (no long hook ships).
- Backfill card has no source `articleId` (hand-seeded): skipped untouched (left `published`), counted in `keptUnchanged` — never removed.
- Regeneration fails validation / returns duplicate: original restored to `published`, counted in `keptUnchanged` (it keeps its long hook but stays in the feed). An exception restores it too, counted in `errored`. No card is lost.
- A card over-long on BOTH body and hook: matched once by the OR filter, regenerated once. No double-processing.

## Testing

- **Pure (`generateLogic.test.ts`):**
  - `HOOK_MAX_CHARS === 90`.
  - `generatedCardSchema` rejects a 200-char hook; accepts a valid card with an ~80-char hook (and otherwise-valid fields).
  - `buildGenerationPrompt(...)` output contains the hook-length rule (assert on the distinctive substring, e.g. "one short line" / "~12 words").
- **convex-test (`generateDb.test.ts`):**
  - Seed three published cards: (a) long hook + short body, (b) short hook + long body, (c) both short. `overlongPublished({ cap: 480, hookCap: 90, limit: 50 })` returns exactly (a) and (b), not (c).
- All offline via `npm run verify`. (The backfill action's live model call is exercised manually via `npx convex run`, not unit-tested — same as the existing body backfill.)

## Out of scope (future)

- Hook-only regeneration that preserves the exact original fact (a separate LLM pipeline).
- Tightening the CSS hook line-clamp below 5.
- The deferred trending-people content guard and image-tone guard (other sub-projects).
