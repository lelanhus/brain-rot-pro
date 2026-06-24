# Card & Feed Redesign — Design Spec

**Date:** 2026-06-24
**Status:** Draft for review
**Supersedes interaction patterns in:** `src/lib/components/Card.svelte`, `src/lib/components/CardActions.svelte`, `src/lib/actions/swipeActions.ts`, card styles in `src/app.css`

---

## 1. Problem

The feed is a one-card-per-viewport snap feed (brain-rot format), but it's a *depth* product wearing an *anti-depth* interface. Concretely:

- **The payoff is hidden.** "Why it matters" (the single most valuable sentence) and the full body live behind tap-to-open overlays. The feed's muscle memory is *scroll, don't tap*, so those taps almost never happen — the best content is invisible.
- **"Read more" is self-inflicted.** The body is clipped only because the card is forced to fit one screen, then re-offered as a tap.
- **The chips are busy.** Up to four concept tags (each a dot + word) sit *in the middle of the reading column* — navigation masquerading as content, competing with the actual words.
- **Three competing explore affordances** crowd every card: chip re-rank, "More like this," and "Source."

The cosmetics are downstream of the structure. The fix is to restructure the card around how the feed is actually used: a glanceable face, depth one deliberate move away, and signal collection that feels native.

## 2. Goals / Non-goals

**Goals**
- The core idea (hook + the "why") is legible at a glance with **zero taps**.
- Depth (full body, source, related concepts) is reachable with **one feed-native gesture**.
- Collect **explicit taste signal** (like / dislike) with minimal friction.
- Support a **lead image** per card (the "images soon" modality) — including full-bleed — with **guaranteed text legibility**.
- Degrade gracefully when a card has **no image**.

**Non-goals**
- No carousel / horizontal paging (see §4, gesture budget).
- No streak or session-count chrome on the card (removed).
- No text-only/no-image card type — **every card ships with a lead image** (see §3b).
- Not redesigning the generation pipeline beyond the image-legibility + image-guarantee steps (§6).

## 3. Card anatomy

One card type: a full-bleed image with overlaid chrome. Every card has an image (§3b).

### 3a. The card (full-bleed)
```
┌─────────────────────────────┐
│                  [⌕] [LH]    │  ← top-right chrome: Explore · Account avatar
│                              │
│        (full-bleed image)    │
│                              │
│  KICKER (muted)              │
│  Hook — the poster           │  ← bottom-left caption
│  One-line teaser             │
│  ▍Why it matters (accent)    │  ← the payoff = the one accent moment
│  • •   Tap to read     [♥129]│  ← page dots + hint        [👎 Less]
│                          [🔖 Save]│ ← bottom-right vertical rail
│  A. Reader · CC BY-SA 4.0    [↗ Share]│
└─────────────────────────────┘
```
- Image fills the card. Text + rail overlay it on a scrim (§6).
- **Accent moves from the kicker to the payoff** — the insight gets the single warm moment; the format kicker drops to muted. (Preserves the "one spark per card" principle.)

### 3b. Every card has an image
All cards are full-bleed — there is no text-only layout. This is a hard requirement on the generation pipeline: a card is not publishable until a free-licensed lead image (Commons, ADR-005) is attached and its legibility level is computed (§6).
- **Pipeline edge case (carry to plan):** what happens when no suitable image is found for a topic — hold the card from publishing (quality bar), or attach a deterministic branded/topical fallback background. Recommended default: **hold the card** so the feed never shows a degraded card; revisit if it starves supply.

### 3c. Depth ("page 2")
Opened by single-tap; a sheet slides up over the card. Contains:
- Full body text.
- **Concept chips** (relocated here from the face — this is what de-busies the face).
- **Topic + Follow row** — names the source topic (e.g. "Testing effect") with a `＋ Follow` toggle. This is Follow's home (see §5): low-frequency, self-labeling next to the named topic, off the face.
- Source: quote + Wikipedia link + license line.
- Closed by tapping the grip or single-tapping again. Page dots track face ↔ depth.

## 4. Gesture map

Every input does exactly one job. This is the core architectural decision.

| Input | Job |
|---|---|
| **Vertical swipe** | next / previous card (the feed) |
| **Single tap** | open / close the depth sheet — *free for us; no video to pause, unlike TikTok* |
| **Double-tap** | like (heart burst, rail like fills) |
| **Bottom-right rail buttons** | like · dislike · save · share (explicit + accessible mirrors) |
| **Horizontal swipe** | **left free, deliberately** — no carousel, no collision |

**Why this allocation:**
- Like/dislike claim the most valuable surface for taste signal. Following the proven feed playbook (TikTok/IG put *like* on double-tap + a button rail, **not** a swipe), taste stays off the swipe axes so they remain clean.
- Putting like on **double-tap (not swipe) is what keeps single-tap free and instant for open/close.** The two decisions reinforce each other — do not move like to a swipe or open will collide with the vertical feed.
- Horizontal swipe is left free rather than used for a carousel: a carousel collides with the vertical snap feed (diagonal ambiguity) and there's no payoff worth that cost.

## 5. Signal & action model

- **Like / Dislike** — primary taste signal. Mutually exclusive, reversible, signal weighted softly (an accidental tap isn't catastrophic). Like via double-tap or rail; dislike via rail (no app makes dislike a swipe; we expose it as a button — our one deliberate divergence from TikTok/IG, which bury it).
- **Dislike absorbs "Not interested."** A left-swipe-dismiss and a 👎 both meaning "negative" is redundant. Unify: **dislike = negative signal + advance to next card.** Like does **not** auto-advance.
- **Save** — utility ("keep to revisit"), a rail button, not a swipe. The only bookmark icon on screen, so it unambiguously means "save this card." The saved *collection* is reached behind the account avatar.
- **Share** — rail button.
- **Open the sheet** is itself a strong "go deeper" signal (stronger than passive dwell) — feed it to personalization (replaces today's `card_expand`).

- **Follow (topic)** — `interests.add/remove`, keyed by a slug from `source.articleTitle`. **Decision: lives in the depth sheet** as a Topic + `＋ Follow` row (§3c). It's low-frequency (you don't follow on most cards), so it doesn't earn face real estate the way per-card like/save do; placing it beside the named topic makes it self-labeling and dodges title-truncation on the face.

- **"More like this" / concept re-rank** — today `embeddings.forCard` dive + `focusConcept`. **Decision: consolidate into the depth sheet.** The concept chips there re-rank the feed, and the semantic dive entry point moves into page 2 too — keeping all explore affordances off the face.

## 6. Legibility guarantee (full-bleed)

Legibility must be **independent of the specific image**. Layered, deterministic stack:

1. **Darken** — flat dark tint (~28%) over the whole image → caps maximum brightness.
2. **Directional scrim** — bottom-heavy gradient (≈86%→transparent by ~62%) behind the caption + rail; a lighter top gradient behind the top-right chrome.
3. **Text-shadow** — on kicker / hook / teaser / payoff for glyph-edge insurance over busy areas.
4. **Pipeline luminance check (the actual guarantee)** — at image ingest, sample the luminance of **both the bottom third and the top strip**; store a per-card `scrim` level (`light` | `medium` | `heavy`). Most images stay `light` (photo vivid); only bright/busy ones get bumped. Optionally extract a **dominant dark color** to tint the gradient so it reads as part of the photo, not a black bar.
5. **Frosted plate (escape hatch)** — a blurred dark panel behind the text for any pathological image; bulletproof, used only when the luminance check flags it.

Stress-test finding: the **top-right chrome is the weak point** (light scrim up top). The luminance check must cover the top strip, and the top icons keep slightly stronger glass backings.

**Theme:** the card face is theme-independent (white text on scrim in both light & dark). Only the **depth sheet** follows the app's light/dark theme.

## 7. Mapping to existing code

- `Card.svelte` — restructured: face (kicker/hook/teaser/payoff), full-bleed image + scrim layers, depth sheet, bottom-right rail. The existing `reveal-overlay` mechanism generalizes into the depth sheet (in-place, doesn't grow the slot — preserves snap).
- `CardActions.svelte` — replaced by the bottom-right vertical rail (like/dislike/save/share). Follow relocates (see §5 open question).
- `swipeActions.ts` — horizontal save/dismiss removed (axis freed). Keep the graduated `--swipe-progress` preview technique if any swipe action is reintroduced later.
- `dwell.ts` — unchanged; still drives active-card + completion + personalization. Sheet-open becomes the stronger deepening signal.
- `app.css` — card styles reworked per above; tokens unchanged.
- Schema (`knowledgeCards`) — add `image.scrim` (legibility level) and optionally `image.dominantColor`. Existing fields (`hook`, `body`, `whyItMatters`, `conceptTags`, `source`, `image`) otherwise reused.

## 8. Testing considerations

- Tap vs double-tap disambiguation (≈230ms) — verify open doesn't feel laggy; consider a dedicated open affordance if it does.
- Legibility regression: render the caption + top chrome over Bright and Busy synthetic backgrounds; assert AA contrast in the text zone for each stored `scrim` level.
- Pipeline image guarantee: a card cannot publish without a lead image + computed `scrim` level; the no-image edge case is handled per §3b.
- Depth sheet in both themes.
- Inner taps in the depth sheet (chips, source link, Follow) must not close the sheet (stopPropagation).
- Like/dislike reversibility and mutual exclusion; dislike advances, like does not.
- Snap integrity: opening the sheet must not scroll the feed (sheet is `position:absolute`, doesn't grow the slot).

## 9. Decisions captured

1. One card type: full-bleed image. Every card has an image; no text-only layout.
2. Text + caption bottom-left; vertical rail bottom-right; account chrome top-right.
3. Single-tap = open depth; double-tap = like; horizontal swipe free.
4. Like/dislike/save/share rail; dislike absorbs not-interested; save is the only bookmark.
5. Chips + source + "more like this" relocate into the depth sheet.
6. Accent moves kicker → payoff.
7. No streak / session-count chrome on the card; keep transient milestone toasts.
8. Legibility = darken + scrim + shadow + pipeline luminance check (+ frosted-plate escape hatch).
9. Every card has an image (full-bleed only); pipeline enforces it.
10. Follow lives in the depth sheet (Topic + `＋ Follow` row), not on the face.
11. "More like this" / concept re-rank consolidates into the depth sheet.

**Still open:** the pipeline's no-image edge case (§3b) — hold vs. fallback background.
