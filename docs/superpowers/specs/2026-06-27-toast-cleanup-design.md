# Toast Cleanup — Design

**Date:** 2026-06-27
**Status:** Approved, ready for implementation planning.

## Context

The user finds toast notifications annoying ([[avoid-toasts-ui-feedback]]). W5
already removed the rate-limit toast; this removes the **remaining** toasts and
replaces the one piece of feedback that genuinely matters (clipboard-copy
confirmation) with quiet, inline, in-place feedback. No global notification
system is introduced.

## Inventory (the entire toast surface)

6 `toast.show` calls across 2 files (no milestone/celebration toasts exist):

| Message                                 | File                                  | Trigger                  | New treatment                  |
| --------------------------------------- | ------------------------------------- | ------------------------ | ------------------------------ |
| "Link copied"                           | `+page.svelte`, `c/[id]/+page.svelte` | `shareCard` → `'copied'` | **inline button confirmation** |
| "Could not share"                       | both                                  | `shareCard` → `'failed'` | **silent** (`console.error`)   |
| "No related cards yet — keep exploring" | `+page.svelte`                        | dive found nothing       | **silent** (nothing)           |
| "Could not load related cards"          | `+page.svelte`                        | dive threw               | **silent** (`console.error`)   |

## Decisions (locked)

- **Share copy → inline confirmation on the Share button.** When `shareCard`
  returns `'copied'` (the clipboard fallback — desktop / no native sheet), the
  Share button briefly swaps its icon to a check and its hidden label to "Copied"
  (~1.5 s), then reverts. `'shared'` (the OS share sheet already confirmed) and
  `'cancelled'` show nothing.
- **Everything else is silent.** Share/dive **errors** log via `console.error`;
  the **empty-dive** case does nothing (tapping again is harmless).
- **Remove the toast machinery entirely.** Delete the `toast` instances + render
  blocks from both files, delete `src/lib/toast.svelte.ts`, and remove the
  `.toast` rule from `app.css` (no other consumers — verified).

## Change set

- **`src/lib/components/CardActions.svelte`** — add an optional prop
  `justCopied?: boolean`. The Share button reflects it: check icon + hidden label
  "Copied" + `aria-label="Link copied"` when true; the existing share icon +
  "Share" otherwise. (Icon swap is instantaneous — no animation, so no
  reduced-motion concern.)
- **`src/routes/+page.svelte`** —
  - `handleShare`: on `'copied'` set a transient `shareCopied` state (`$state`,
    cleared by a ~1.5 s timeout that's reset on repeat); on `'failed'`
    `console.error`; `'shared'`/`'cancelled'` do nothing. Pass
    `justCopied={shareCopied}` to `CardActions`.
  - Dive handler: drop the "No related cards" toast (do nothing) and the "Could
    not load related cards" toast (keep the existing `console.error`).
  - Remove the `createToast` import, the `const toast` instance, and the
    `<div class="toast" …>` render block. Clear the timer on component teardown.
- **`src/routes/c/[id]/+page.svelte`** — local `copied` `$state` in `onShare`
  (same ~1.5 s revert); the page's `.share-btn` shows the check + "Copied" when
  true; on `'failed'` `console.error`. Remove `createToast`, the instance, and the
  toast render block.
- **`src/lib/toast.svelte.ts`** — delete.
- **`src/app.css`** — remove the `.toast` rule.

## Error handling / edge cases

- The `shareCopied` / `copied` timer must be cleared on teardown (and reset if the
  user copies again before it expires) so it can't fire after navigation.
- Native share (`'shared'`) and user-cancelled (`'cancelled'`) intentionally show
  nothing — the OS already gave feedback or the user backed out.
- Accessibility: the Share button's `aria-label` flips to "Link copied" while in
  the copied state so screen-reader users still get the confirmation; the
  visible/hidden label text matches.

## Testing

- **Component** (`CardActions.svelte.spec.ts`): with `justCopied={true}` the Share
  button renders the "Copied" label + `aria-label="Link copied"`; with it
  false/absent it renders "Share". (Existing CardActions tests must still pass —
  the new prop is optional.)
- Confirm no test asserts toast text (verified: none do; only a `data-testid` on
  the now-removed render block — drop it).
- `bun run verify` green (typecheck + lint + unit + convex + component).
- **Manual:** desktop copy → Share button shows check/"Copied" ~1.5 s then reverts;
  mobile native share → OS sheet, no inline change; errors → nothing visible,
  logged to console.

## Out of scope

- The W5 rate-limit feedback (already silent).
- Any global/inline notification system (explicitly not wanted).
- The remaining toasts are the complete set — nothing else uses `createToast`.
