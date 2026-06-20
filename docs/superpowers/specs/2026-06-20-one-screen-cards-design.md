# One-screen cards — design

**Date:** 2026-06-20
**Status:** Approved (pending spec review)

## Problem

The feed is meant to be a swipe-driven "one idea, full attention" experience.
`docs/ui-ux.md` states the intent plainly: *"One card fills the viewport. Nothing
competes with the hook."* and *"One card == one snap stop."* The implementation
has drifted from this: on smaller phones a card's content overflows the viewport,
so the reader scrolls *within* a card before reaching the next snap point.

Two causes:

1. **Content model.** Generation allows a body up to **1,400 characters**
   (`convex/generateLogic.ts`, `generatedCardSchema`) — far more than fits one
   phone screen alongside a hook, image, and tags.
2. **Layout.** `.slot` uses `min-height: 100dvh` and is explicitly allowed to
   grow past the viewport ("the slot just grows past 100dvh and the feed
   scrolls"). The hook font also drifted larger than the spec
   (`--fs-hook: clamp(1.9rem, 1.2rem + 3vw, 3rem)` implemented vs
   `clamp(1.6rem, 4.5vw, 2.3rem)` specified).

## Goal

Every card fits within one viewport with **no internal scroll** — swipe moves to
the next card; it never scrolls content within the current one.

## Decisions (from brainstorming)

- **Long content → cap it shorter** at generation so every card fits. No body
  scroll, no body "read more" expand.
- **Visible without any tap:** hook + body + image + tags. "Why it matters",
  "Source", and "More like this" remain compact tappable controls *on* the
  screen; their detail opens as a non-scrolling overlay/inline reveal that does
  not push content off-screen.
- **Fit target:** guarantee a no-scroll fit on modern phones, **≥ 375×667 dvh**
  (iPhone SE 2022 and up). 320×568 is best-effort. Larger phones get more
  breathing room.

## Non-goals

- Auto-shrinking body text to fit (rejected — inconsistent, off-brand).
- Redesigning the action rail, navigation, or card visual style beyond what fit
  requires.
- Changing the feed's scroll-snap mechanics between cards.

## Design

### 1. Content model — `convex/generateLogic.ts`

- Lower body `max` from `1400` to a one-screen budget: **~480 characters**
  (~3–4 tight sentences). Keep `min` ~80.
- Nudge the generation prompt toward "one tight paragraph" so the model targets
  the new ceiling rather than being truncated by the validator.
- Hook (8–180) and `whyItMatters` (≤360, collapsed) unchanged.
- The 480 figure is **derived from the vertical budget in §2 and confirmed on a
  375×667 screen during implementation**, not a guess. Adjust to the measured
  value if the budget says so.

### 2. Layout — `src/app.css`

Make the slot a true one-viewport box so it physically cannot scroll:

- `.slot`: `height: 100dvh` (not `min-height`) + `overflow: hidden`, vertical
  flex column. Remove the "grows past 100dvh" behavior.
- Vertical budget within the slot, expressed with existing space/type tokens (no
  magic numbers):
  - top inset (safe-area + existing top padding)
  - **image** — capped via `max-height` ~30dvh (so a tall image can't crowd out
    the text); attribution line below it
  - **hook** — restore to the spec size `clamp(1.6rem, 4.5vw, 2.3rem)`
  - **body** — the flex-shrink region; carries a `-webkit-line-clamp` safety net
    sized to the remaining space so an oversized (legacy) body clips instead of
    scrolling
  - **tags** — one wrapped row
  - **controls** — compact "why it matters" / "source" / "more like this"
  - bottom `--action-zone` reserve trimmed to just clear the fixed action rail
- **Reveals** ("why it matters", "source", "more like this") open as
  non-scrolling overlays / inline expansions that do not push other content
  off-screen, so opening one never introduces scroll.

### 3. Existing over-long cards (already published)

There are published cards with bodies up to 1,400 chars in production.

- The `line-clamp` safety net (§2) keeps them within one screen immediately.
- **Then:** a one-time pass that suppresses or regenerates bodies over the new
  cap, so legacy cards aren't silently truncated mid-fact (a clamped fact loses
  its payoff). Preferred over leaving them to age out of the feed.

## Testing

- Visual/component test: assert no card scrolls (`scrollHeight <= clientHeight`
  for the slot) at 375×667, 320×568 (best-effort), and a large phone, for cards
  with and without an image and at the body length cap.
- Unit test: body length cap is enforced by `generatedCardSchema`.
- Manual check on the deployed site after release (push to main → Vercel;
  backend via `npx convex deploy` locally).

## Open items

None blocking. The body cap (~480) is confirmed empirically during
implementation against the §2 vertical budget.
