# One-Screen Fit — Design Spec

**Date:** 2026-06-23 · **Status:** Approved · **Direction:** content & feel (visual feel, sub-project 2)

## Goal

The product's core feel is "one calm idea per snap." Right now that breaks on every image card: a live run showed the lead image (~24dvh) + a 4–6 line hook + body **overflowing the viewport and clipping the body** (e.g. a Joe Biden card cut off mid-sentence). `.slot` is `min-height: 100dvh` and simply grows, so long cards force intra-card scrolling or hide their own text. Make **every card compose to exactly one viewport** (100dvh minus the reserved chrome) so each card is a single clean snap stop — no clipped text, no intra-card scroll.

This is the agreed scope for sub-project 2: **one-screen-fit only** (image sizing, body fit, hook line-count at the layout level). Hook-length-at-generation and image-tone are explicitly out of scope (noted at the end).

## Root cause

- `.slot` grows past `100dvh` instead of bounding the card.
- `.body`'s rule never got the `flex/overflow` behavior its own comment describes — it just flows and overflows.
- `.card-image` is a fixed `max-height: 24dvh` that never yields, so it crowds out text on short viewports / long hooks.
- A runaway hook (the design intends 2–3 lines / ~22ch; live hooks ran 6 lines) has no line cap, so it pushes the body off-screen.

Body length is **not** the main culprit: bodies are generation-capped at `BODY_MAX_CHARS = 480` (`convex/generateLogic.ts`), trimmed at a sentence boundary. The overflow is driven by image + hook. So once the image yields and the hook clamps, the body usually fits in full.

## Decisions (YAGNI)

- **Height-bounded flex column with a deliberate yield order.** The card fills exactly one screen and gives up space in this order: **image shrinks → hook clamps → body clips (with fade + read-more) → explore controls stay pinned.** Order is the whole trick.
- **`.slot`: `min-height: 100dvh` → `height: 100dvh`.** `.card` becomes `display:flex; flex-direction:column; height:100%; min-height:0`. Existing slot padding already reserves the top inset + bottom `--action-zone` + safe-area, so "fill the card" == "fill one screen."
- **Image yields first.** `.card-image`: `flex:0 1 auto; min-height:0; max-height: clamp(120px, 24dvh, 30dvh)`; `img { height:100%; object-fit:cover }`.
- **Hook line-clamp safety net.** `-webkit-line-clamp: 5` (with `display:-webkit-box; -webkit-box-orient:vertical; overflow:hidden`). Full hook text stays in the DOM with a `title` attribute for a11y/hover. The real fix (shorter hooks at generation) is out of scope.
- **Body is the flexible region.** `.body { flex:1 1 auto; min-height:0; overflow:hidden }` + a bottom **fade mask** (`mask-image: linear-gradient(...)`) applied only when clipped, so truncation reads as "more below," not a hard cut.
- **Explore controls pinned.** why/source toggles + `.chips` + `.more` become `flex:0 0 auto` at the column bottom (above the action zone) so they're always on-screen — today they fall below the fold on long cards.
- **"Read more" only when actually clipped (progressive enhancement).** A minimal `ResizeObserver` in `Card.svelte` sets a `clipped` flag when the body's `scrollHeight > clientHeight`. When set, a "Read more" button appears and opens the **full body in the existing `.reveal-overlay`** by extending `reveal` from `'why' | 'source' | null` to also accept `'body'`. With no JS, the body just clamps with the fade and the full text remains reachable via Source / the `/c/[id]` page.
- **No new motion.** Fade mask is static; line-clamp + overlay are motion-free; existing `prefers-reduced-motion` block is untouched. "Read more" is a real `<button>` in tab order.

## Components

- `src/app.css`:
  - `.slot`: `min-height: 100dvh` → `height: 100dvh` (keep padding, snap, touch-action).
  - `.card`: add `display:flex; flex-direction:column; height:100%; min-height:0` (keep `max-width`, positioning context).
  - `.card-body`: add `flex:1 1 auto; min-height:0` (it is already `display:flex; flex-direction:column`). This is the sibling of `.card-image` inside `.card`, so the flex chain is `.card` (col, 100%) → [`.card-image` 0 1, `.card-body` 1 1] → [tag 0 0, hook clamp, `.body` 1 1, chips/controls 0 0]. Without this, `.body`'s `flex:1 1` has no flexible parent to grow within.
  - `.card-image`: `flex:0 1 auto; min-height:0; max-height: clamp(120px, 24dvh, 30dvh)`; ensure `.card-image img { height:100%; object-fit:cover }` (already `object-fit:cover`).
  - `.hook`: add `display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:5; overflow:hidden` (keep type styling).
  - `.body`: add `flex:1 1 auto; min-height:0; overflow:hidden`; add `.body[data-clipped='true'] { mask-image: linear-gradient(to bottom, #000 78%, transparent) }` (and `-webkit-mask-image`).
  - `.read-more`: a quiet text affordance matching `.why-toggle` (accent-free, `--fs-meta`, 44px target), shown only when clipped.
  - Reduced-motion: confirm no change needed (mask is static).
- `src/lib/components/Card.svelte`:
  - Extend `reveal` type to `'why' | 'source' | 'body' | null`; add a `toggleBody`/handler and a `{:else if reveal === 'body'}` branch in `.reveal-overlay` rendering the full `card.body`.
  - `bind:this` on the `.body` element + an action/`$effect` with `ResizeObserver` (and a window-resize fallback) setting `clipped = el.scrollHeight > el.clientHeight`; reflect as `data-clipped` on the body and to gate the "Read more" button.
  - Add `title={card.hook}` on the `.hook` element (full text for the clamped case).
- No schema, Convex, or generation changes.

## Data flow

```
render card → height-bounded flex column (height:100dvh slot, card fills it)
  image (flex 0 1, max clamp)  →  shrinks first
  hook  (line-clamp 5)         →  clamps, full text in title=
  body  (flex 1 1, overflow hidden) → fills remaining; ResizeObserver:
       scrollHeight > clientHeight  ⇒  clipped=true ⇒ fade mask + "Read more"
  chips / why / source / more  (flex 0 0)  →  pinned, always visible
"Read more" → reveal='body' → existing .reveal-overlay shows full body
```

## Error handling / edge cases

- No image: image node absent; the flex column still fills correctly (hook/body/controls distribute).
- Very short viewport (small phone): image clamps to its `120px` floor; if still tight, body clips and "Read more" appears — nothing is unreachable.
- No JS (ResizeObserver unavailable / disabled): `clipped` stays false → no fade/read-more, body clamps via `overflow:hidden`; full text via Source / `/c/[id]`.
- Reveal already open for why/source: opening 'body' replaces it (single `reveal` slot, existing behavior).

## Testing

- **Component (`Card.svelte.spec.ts`):**
  - When body content exceeds its box (simulate by forcing `clipped`/small height), the "Read more" button renders; clicking it sets the overlay to the `'body'` view showing the full `card.body`; closing returns to null. (ResizeObserver is environment-dependent in jsdom — drive the `clipped` state directly or via a prop/exported setter rather than relying on real layout measurement.)
  - When body fits (not clipped), no "Read more" button is rendered.
  - `.hook` carries a `title` equal to `card.hook`.
- **Visual verification (manual, scripted in the plan):** re-run the dev app, load a long card (image + multi-line hook), screenshot at a phone viewport — confirm the whole card (tag → hook → body → chips/controls) fits within one viewport with the action stack visible and no clipped-without-affordance text. Repeat with reduced-motion on.
- All offline checks via `npm run verify`.

## Out of scope (future)

- **Hook length at generation** — cap hook to ~2–3 lines in the prompt/validator (the real fix; this spec only clamps at the layout level).
- **Image-tone guard** — suppressing jarring lead images (e.g. crime mugshots) for notoriety topics; belongs with the deferred trending-people content work (Approach B).
- Desktop-gutter refinements beyond what the fit change implies.
