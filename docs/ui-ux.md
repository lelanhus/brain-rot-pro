# UI/UX Design

**Last updated:** 2026-06-15
**Scope:** the v1 consumer feed. **Mobile-first** (Leland's primary device, phone), with desktop treated as a first-class adaptation — not an afterthought, not a separate design.
**Status convention:** sections marked **🔒 foundational** are content-independent and gate Phase 1 — build to them now. Sections marked **🌀 provisional** describe the "feel" and should be refined _after_ the Phase-0 content judgement (don't over-polish an experience before the cards are proven; that's the doc's "accurate but boring" trap inverted).

This doc specifies what the code in `src/app.css`, `src/lib/components/Card.svelte`, and `src/routes/+page.svelte` should converge to. UX gates are in §11 and feed the `verify` loop.

---

## 1. Principles (UX translation of the product thesis)

1. **Thumb-first.** The primary device is a phone held one-handed; the core loop (read → continue → react) must be reachable in the thumb zone with zero precision.
2. **Instant.** No spinner between cards, no layout shift on first paint. Perceived next-card latency < 100ms (acceptance-criteria Phase 0).
3. **One idea, full attention.** One card fills the viewport. Nothing competes with the hook.
4. **Calm dopamine.** Motion and feedback reward continuation without feeling like a slot machine — addictive _quality_, not rage-bait (review §4.2: north star is curiosity continuation, not "addiction").
5. **Source is present but quiet.** Trust affordance always one tap away, never in the way (design doc §3.3, §6.2).
6. **Desktop is the same feed, wider.** Same single-column reading experience, centered, with keyboard parity — not a dashboard.

---

## 2. Design tokens 🔒

Formalizes the ad-hoc values currently in `app.css`. These become CSS custom properties; treat them as the single source of truth.

### Color (dark is the default; light is §9)

| Token         | Value     | Use                                      |
| ------------- | --------- | ---------------------------------------- |
| `--bg`        | `#0b0b0f` | App background                           |
| `--surface`   | `#15151d` | Card/raised surface                      |
| `--surface-2` | `#23232f` | Chips, tag pills                         |
| `--border`    | `#25252f` | Hairlines, dividers                      |
| `--text`      | `#f3f3f7` | Primary text                             |
| `--text-2`    | `#c8c8d2` | Body emphasis / quotes                   |
| `--muted`     | `#9a9aa8` | Secondary text, source                   |
| `--accent`    | `#7c6cff` | Format tag, links, focus, primary action |
| `--positive`  | `#36c98e` | Save confirmation                        |
| `--negative`  | `#ff6b6b` | Not-interested, errors                   |

Contrast: all text/!background pairs must meet **WCAG AA (4.5:1 body, 3:1 large)**. `--muted` on `--bg` is the one to watch — verify, darken background or lift muted if it fails (§11).

### Type scale (fluid, mobile→desktop via `clamp`)

| Token       | Size                                                    | Use                       |
| ----------- | ------------------------------------------------------- | ------------------------- |
| `--fs-hook` | `clamp(1.6rem, 4.5vw, 2.3rem)` / weight 750 / line 1.15 | Hook (the scroll-stopper) |
| `--fs-body` | `1.075rem` / line 1.55                                  | Body                      |
| `--fs-why`  | `0.95rem`                                               | Why-it-matters            |
| `--fs-meta` | `0.78–0.9rem`                                           | Source, chips, license    |
| `--fs-tag`  | `0.72rem` / uppercase / tracking 0.06em                 | Format tag                |

System font stack (no web-font fetch on first paint — protects the "instant" goal). Reassess a display face for the hook only after content judgement (🌀).

### Spacing / radii / motion

- Spacing scale: `4 / 8 / 12 / 16 / 24 / 32 px`. Card gutter: `1.5rem` mobile, scales to centered `640px` column on desktop.
- Radii: `6px` (inline), `12px` (cards/sheets), `999px` (pills).
- Motion durations: `--dur-fast 120ms`, `--dur 200ms`, `--dur-slow 320ms`; easing `cubic-bezier(0.2, 0, 0, 1)`. **All motion gated by `prefers-reduced-motion`** (§6).

---

## 3. Layout & responsive 🔒

Mobile-first; one breakpoint that matters plus a max-width clamp.

| Range                                     | Layout                                                                                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phone** (default, `< 700px`)            | Full-bleed `100dvh` card, scroll-snap, content padded to gutter; action bar bottom-right thumb zone (§4); safe-area insets respected.                                      |
| **Tablet / small desktop** (`700–1100px`) | Same single column, centered, `max-width: 640px`; action bar may move to a right rail beside the column.                                                                   |
| **Desktop** (`> 1100px`)                  | Centered `640px` reading column; actions as a right rail; keyboard is a first-class input (§5); generous side whitespace; optional faint "↓ next" hint on first card only. |

Rules:

- One card == one snap stop (`scroll-snap-align: start`, `scroll-snap-type: y mandatory`) at all sizes.
- **No horizontal scroll, ever.** Chips wrap.
- `dvh` (not `vh`) so mobile browser chrome doesn't crop cards.
- First paint must be **zero-CLS** — reserve space for tag/hook/body; images (when added) get fixed aspect boxes.

---

## 4. Card anatomy & actions 🔒

Refines design doc §6.3 into a build spec. Current `Card.svelte` has the content half; the **action half is unbuilt** (Phase 1).

**Content (top→bottom):** format tag → hook → body → why-it-matters (optional) → concept chips → source disclosure (collapsed) with span + Wikipedia link + license line.

**Actions** — these are also the Phase-1 event signals (engineering-standards/§ acceptance); building them = building the event layer.

| Action                 | Mobile control              | Desktop control        | Event emitted                            |
| ---------------------- | --------------------------- | ---------------------- | ---------------------------------------- |
| **Continue**           | scroll/swipe up             | scroll / `↓` / `Space` | `card_complete` / `card_skip` (by dwell) |
| **Save**               | tap save icon (thumb-zone)  | rail button / `S`      | `save`                                   |
| **Not interested**     | tap / swipe-left affordance | rail button / `X`      | `not_interested`                         |
| **Expand / go deeper** | tap card body or "more"     | click / `E`            | `card_expand`                            |
| **Source**             | tap "Source" disclosure     | click / `V`            | `source_open`                            |
| **Related tap**        | tap a concept chip          | click chip             | `related_tap`                            |

Action-bar placement: **bottom-right vertical stack** on phone (TikTok-pattern, thumb-reachable), **right rail** on desktop. Min tap target **44×44px**. Icons + accessible labels (not icon-only without `aria-label`).

Concept chips become **tappable** (currently static) — tapping pivots the feed toward that concept (Phase 3 pathway; in Phase 1 it just logs `related_tap`).

---

## 5. Keyboard & gestures 🔒

**Gestures (mobile):** vertical swipe = next/prev (native snap is the baseline; add velocity tuning if snap feels loose — 🌀). Optional swipe-left = not-interested, swipe-right = save (with visual affordance) — **provisional**, validate it doesn't fight scroll.

**Keyboard (desktop, full parity):**

| Key           | Action                |
| ------------- | --------------------- |
| `↓` / `Space` | Next card             |
| `↑`           | Previous card         |
| `S`           | Save                  |
| `X`           | Not interested        |
| `E`           | Expand                |
| `V`           | Open source           |
| `Esc`         | Close expanded/source |

Focus moves with the active card; a visible `:focus-visible` ring (`--accent`) on all interactive elements.

---

## 6. Motion 🌀 (provisional — refine after content judgement)

- Card-to-card: rely on native scroll-snap; add a subtle settle (opacity/translate ≤ `--dur`) only if it improves feel.
- Save: brief scale-pulse + color flash to `--positive`. Not-interested: card de-emphasizes/slides.
- Source disclosure: height/opacity ease (`--dur`).
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` removes transitions/transforms, keeps instant state changes. This is a hard a11y gate (§11), not optional.

---

## 7. State catalog 🔒

Every state needs a defined visual; silence/blank is a failure (fail-fast UX).

| State                 | Treatment                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **First paint (SSR)** | First card fully rendered, no spinner, no null flash (ADR-001).                                                               |
| **Loading more**      | Subtle bottom affordance (`.state.subtle`); never blocks current card.                                                        |
| **End of feed**       | A graceful "you're caught up" card with a way to keep going (wildcards/restart) — not a dead end (design doc: infinite feed). |
| **Empty**             | Friendly message + seed hint (dev) / "warming up" (prod).                                                                     |
| **Error**             | Inline, human message + retry; surfaced, never swallowed (engineering-standards §1).                                          |
| **Offline**           | Show cached cards; banner that updates paused.                                                                                |

---

## 8. Accessibility 🔒

- **AA contrast** for all text (verify `--muted`).
- **Keyboard:** everything operable without a pointer (§5); visible focus.
- **Screen reader:** feed is a labelled region; new cards announced via `aria-live="polite"` (not assertive — don't interrupt). Each card is an `<article>` with the hook as its heading (already true).
- **Targets:** ≥ 44×44px.
- **Reduced motion** honored (§6).
- **Disclosure:** native `<details>`/`<summary>` (keyboard-accessible by default — keep it).
- Respect `prefers-color-scheme` (§9).

---

## 9. Theming ✅

Dark-default, with **light mode shipped**: a parallel token set applies under `prefers-color-scheme: light` (when on `system`) or a forced `data-theme` attribute. A no-flash inline script in `app.html` sets the forced theme before first paint; the `System / Light / Dark` override toggle lives on `/account` (`src/lib/theme.svelte.ts`, `ThemeToggle.svelte`). ⚠ Light tokens are first-pass — eyeball AA contrast on a real screen and tune `--muted`/`--accent` if needed.

---

## 10. Microcopy & voice 🔒

- **Hook:** declarative, surprising, specific; no clickbait ("You won't believe…"). The example set in `seedData.ts` is the voice reference.
- **Why it matters:** one calm sentence of significance, never hype.
- **Action labels:** plain — "Save", "Not interested", "Go deeper", "Source".
- **Account prompt (later):** "Save your feed?" never "Create an account" (design doc §20.2).
- **Errors:** what happened + what to do, no codes in the user's face.

---

## 11. UX acceptance criteria (add to the loop)

🤖 Machine-checkable (wire into `verify` / e2e as built):

- **Zero CLS** on first paint; first card visible without spinner (e2e + Lighthouse budget).
- **Contrast**: automated axe check passes AA on the card and action bar.
- **Keyboard**: e2e drives ↓/S/E/V and asserts behavior.
- **Reduced motion**: with `prefers-reduced-motion`, no transition/transform animations run.
- **Tap targets** ≥ 44px (axe/measured).
- **No horizontal overflow** at 320px width.

👤 Human-judged:

- Scroll feels instant and "snappy," not floaty, on a real phone.
- The hook stops the scroll; reactions are reachable without looking.
- Desktop feels like the same product, not a port.

---

## 12. Open UX decisions

1. Swipe-left/right for skip/save on mobile — adopt, or keep actions button-only? (validate against scroll conflict)
2. Action bar: floating overlay vs inline-below-card on phone.
3. Whether the hook gets a display typeface (post-content-judgement).
4. End-of-feed behavior: auto-inject wildcards vs explicit "more" tap.
5. Light mode in v1, or dark-only until later.

These are intentionally deferred to after the Phase-0 content read, since they shape "feel" more than function.
