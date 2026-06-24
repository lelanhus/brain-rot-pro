# Card & Feed Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-06-24-card-feed-redesign-design.md`

**Goal:** Turn the feed card from a tap-to-reveal text block into a full-bleed image poster whose core idea is legible at a glance with zero taps, whose depth is one feed-native gesture away, and which collects explicit taste signal (like/dislike) with minimal friction — without ever breaking the one-card-per-viewport snap feed.

---

## Architecture / Design

This is a structural redesign, not a reskin. Four interlocking decisions drive every task below; they reinforce each other and must land together to be coherent.

1. **One card type — full-bleed image with overlaid chrome.** Every published card carries a free-licensed lead image (ADR-005). The text caption (kicker → hook → teaser → payoff) sits bottom-left over a directional scrim; a vertical action rail sits bottom-right; account/explore chrome sits top-right. There is no text-only layout — the generation pipeline _enforces_ an image as a publish gate (Task 4).

2. **A single gesture budget, each input doing exactly one job** (spec §4):
   - **Vertical swipe** → next/previous card (the feed — untouched).
   - **Single tap** → open/close the depth sheet ("page 2").
   - **Double-tap** → like.
   - **Bottom-right rail** → like · dislike · save · share (explicit, accessible mirrors).
   - **Horizontal swipe** → deliberately free (no carousel). `swipeActions` loses its save/dismiss behavior.

   Putting like on double-tap is what keeps single-tap free for open/close; freeing the horizontal axis is what stops a carousel colliding with the vertical snap feed. Neither can move without breaking the other.

3. **Depth lives in a sheet, not inline.** The existing non-flow-growing `.reveal-overlay` mechanism (which already preserves snap by being `position:absolute` and not growing the slot) generalizes into a single depth sheet that slides up over the card. It absorbs everything taken off the face: full body, concept chips (which still re-rank the feed), the source quote/link/license, the "more like this" semantic dive, and the **Topic + `＋ Follow`** row. Page dots track face ↔ depth. Only the sheet follows the app's light/dark theme; the face is theme-independent (white-on-scrim).

4. **Like/dislike is the primary taste signal; dislike absorbs "not interested."** Like (double-tap or rail) is a soft positive and does **not** advance. Dislike (rail) is a soft negative **and advances to the next card** — it unifies the old left-swipe-dismiss and 👎. Save and share are rail utilities. Opening the sheet is itself the strong "go deeper" signal (it replaces the old `card_expand` trigger).

**Legibility guarantee (spec §6)** is layered and image-independent: a flat darken tint + a bottom-heavy directional scrim (+ lighter top scrim for the top chrome) + text-shadow, with a per-card `image.scrim` level (`light`/`medium`/`heavy`) computed at ingest from a luminance sample of the top strip and bottom third, and a frosted-plate escape hatch for pathological images. The top-right chrome is the known weak point — the luminance check must cover the top strip, not just the bottom.

**Tech Stack:** Svelte 5 (runes: `$state`/`$derived`/`$effect`), global CSS in `src/app.css` (design tokens unchanged), Convex (internalQuery / mutation / action; Zod for generation schema), Vitest + `vitest-browser-svelte` (component tests run in a REAL browser — layout, pointer events, and `ResizeObserver` work) + convex-test for backend. `convex/_generated` is committed and must be regenerated (`npx convex codegen`) whenever a function signature or the schema changes, and the result committed green.

## Global Constraints

- **Snap integrity is sacred.** Opening the depth sheet must never change the slot's flow height or scroll the feed (sheet is `position:absolute`, like today's `.reveal-overlay`). The "stop the feed from scrolling itself" guarantee (see `+page.svelte` `mergeStableOrder` block) must survive.
- **Attribution is non-negotiable (ADR-005).** The image author + license must remain reachable and legible on every card; relocating it into the depth sheet's Source row is allowed, but it must never be dropped or clipped away.
- **Every published card has an image.** The no-image path is a publish _hold_, not a degraded card (spec §3b decision: hold over fallback background). This is a generation-pipeline gate (Task 4).
- **Face is theme-independent; only the sheet themes.** Do not make the face read off `--bg`/`--text` — it is white-on-scrim in both themes.
- **Accent moves kicker → payoff.** The "one warm moment per card" stays at exactly one — now on "why it matters," with the format kicker dropped to muted.
- **No streak / session-count chrome on the card** (transient milestone toasts stay; see `+page.svelte` `.hud`).
- **bun** is the package runner. Component tests: `bun run test:component`; backend: `bun run test:convex`; full gate: `bun run verify` (do NOT pipe through `tail` — it hides the exit code).
- We develop on branch `claude/optimistic-davinci-fh10mo`. Commit per task as below.

**Task ordering & dependencies:** Tasks 1–4 are the data/backend foundation (schema field, signal model, scrim computation, image gate) and unblock the UI. Tasks 5–8 rebuild the UI (face → sheet → rail/gestures → feed wiring). Task 9 is regression + verification. Tasks 1–4 can land independently of the UI; Tasks 5–8 each depend on 1–2 and should land in order (the face exists before the sheet that hangs off it, before the rail that overlays it, before the page wires it).

---

### Task 1: Schema — per-card legibility level (`image.scrim` + `image.dominantColor`)

**Why:** The card face needs a stored, image-independent legibility level to pick its scrim strength (Task 5), and the pipeline needs somewhere to write it (Task 3). The shared `image` validator is reused by both `knowledgeCards` and `sourceArticles`, so both gain the fields; both are optional so existing rows validate unchanged.

**Files:**

- Modify: `convex/schema.ts` (the exported `image` validator)
- Modify (regenerated): `convex/_generated/*`

**Interfaces:**

- Produces: `image.scrim?: 'light' | 'medium' | 'heavy'` and `image.dominantColor?: string` on every place `image` is embedded (`knowledgeCards.image`, `sourceArticles.image`).

- [ ] **Step 1: Extend the `image` validator.** In `convex/schema.ts`, change the `image` object (currently ends at `attribution: v.string()`) to add two optional fields:

```ts
export const image = v.object({
	thumbnailUrl: v.string(),
	commonsUrl: v.string(),
	author: v.string(),
	licenseShortName: v.string(),
	licenseUrl: v.string(),
	attribution: v.string(),
	// Legibility level for the full-bleed face (redesign §6). Computed at ingest
	// from a luminance sample of the top strip + bottom third; absent → treat as
	// 'medium' at render time (safe default). 'heavy' triggers the frosted plate.
	scrim: v.optional(v.union(v.literal('light'), v.literal('medium'), v.literal('heavy'))),
	// Optional dominant DARK color (e.g. '#1a2433') to tint the gradient so the
	// scrim reads as part of the photo rather than a flat black bar.
	dominantColor: v.optional(v.string())
});
```

- [ ] **Step 2: Regenerate types and confirm check is green.**

Run: `npx convex codegen && bun run check`
Expected: `0 ERRORS`. (Both fields are optional, so no existing data or call site breaks.)

- [ ] **Step 3: Commit.**

```bash
git add convex/schema.ts convex/_generated
git commit -m "feat(schema): add image.scrim legibility level + dominantColor"
```

---

### Task 2: Signal model — `like` / `dislike` events + personalization weights

**Why:** Like/dislike is the new primary taste signal (spec §5). Add the two event types and their personalization deltas. `dislike` absorbs the old "not interested" as a negative signal; `like` is a soft positive. Because `buildTasteVector` already includes any event with a positive `EVENT_DELTA` and excludes negatives, adding the deltas is all that's needed for both concept-weighting and the embedding taste vector to pick them up — no taste-vector code change required.

**Files:**

- Modify: `convex/schema.ts` (`eventType` union) — _note: also a schema change; can be folded into Task 1's codegen+commit if done together, but kept separate here for a clean signal-model commit._
- Modify: `convex/profileLogic.ts` (`EVENT_DELTA`)
- Test: `convex/profileLogic.test.ts`
- Modify (regenerated): `convex/_generated/*`

**Interfaces:**

- Produces: `eventType` accepts `'like'` and `'dislike'`; `EVENT_DELTA.like > 0` and `EVENT_DELTA.dislike < 0`; both flow through `accumulateConceptWeights`/`buildTasteVector` unchanged.

- [ ] **Step 1: Write the failing tests.** In `convex/profileLogic.test.ts`, add a block asserting the new deltas and that they propagate to concept weights (mirror the existing `accumulateConceptWeights` tests' setup):

```ts
describe('like / dislike signal', () => {
	it('like is a positive delta, dislike a negative one (dislike absorbs not-interested)', () => {
		expect(EVENT_DELTA.like).toBeGreaterThan(0);
		expect(EVENT_DELTA.dislike).toBeLessThan(0);
	});

	it('a like raises and a dislike lowers the weight of the card’s concepts', () => {
		const cardTags = { c1: ['testing'] };
		const liked = accumulateConceptWeights([{ type: 'like', cardId: 'c1', ts: 0 }], cardTags);
		const disliked = accumulateConceptWeights([{ type: 'dislike', cardId: 'c1', ts: 0 }], cardTags);
		expect(liked.testing).toBeGreaterThan(0);
		expect(disliked.testing).toBeLessThan(0);
	});
});
```

(Add `EVENT_DELTA` and `accumulateConceptWeights` to the existing import from `./profileLogic` if not already imported. Match the exact arg shape `accumulateConceptWeights` expects in the existing tests.)

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `bun run test:convex -- profileLogic`
Expected: FAIL — `EVENT_DELTA.like`/`.dislike` are `undefined`.

- [ ] **Step 3: Add the event types.** In `convex/schema.ts`, in the `eventType` union, add after `v.literal('not_interested'),`:

```ts
	v.literal('like'),
	v.literal('dislike'),
```

- [ ] **Step 4: Add the deltas.** In `convex/profileLogic.ts`, in the `EVENT_DELTA` map, add (keep the existing entries):

```ts
	// Soft taste signal from the rail / double-tap. Lighter than save / not_interested
	// because a double-tap is accident-prone (redesign §5: weighted softly).
	like: 2,
	dislike: -3,
```

- [ ] **Step 5: Regenerate types and run the tests.**

Run: `npx convex codegen && bun run test:convex -- profileLogic`
Expected: codegen succeeds; tests PASS (new like/dislike block plus all existing profileLogic tests).

- [ ] **Step 6: Commit.**

```bash
git add convex/schema.ts convex/profileLogic.ts convex/profileLogic.test.ts convex/_generated
git commit -m "feat(signal): like/dislike events + personalization deltas (dislike absorbs not-interested)"
```

---

### Task 3: Legibility — scrim-level decision + ingest luminance sample + backfill

**Why:** The legibility guarantee (spec §6) is "independent of the specific image" because a per-card `scrim` level is computed deterministically at ingest from the image's luminance. The _decision_ (luminance → level) is a pure function (the TDD unit); the _sampling_ (decode the thumbnail, average luminance over the top strip and bottom third) is an action step bolted onto the existing image fetch. The known failure mode — a bright top strip washing out the top-right chrome — is handled by sampling **both** regions and taking the worse.

**Files:**

- Create: `convex/legibility.ts` (pure: `scrimLevelFor`, luminance helpers)
- Test: `convex/legibility.test.ts`
- Modify: `convex/ingest.ts` (`fetchBestImage` / `selectFreeImage` wiring — attach `scrim` when an image clears the license gate)
- Modify: `convex/ingest.ts` (`backfillImages` and/or a new `backfillScrim` work-list to compute `scrim` for already-imaged published cards)
- Test: `convex/ingest.test.ts`
- Modify (regenerated): `convex/_generated/*`

**Interfaces:**

- Produces: `scrimLevelFor({ topLuminance, bottomLuminance }: { topLuminance: number; bottomLuminance: number }): 'light' | 'medium' | 'heavy'` (inputs 0–1); `relativeLuminance(r,g,b)`; ingest writes `image.scrim` (+ optional `dominantColor`) onto every newly-attached image.
- Consumes: the `image` shape from Task 1.

- [ ] **Step 1: Write the failing tests for the pure decision.** Create `convex/legibility.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scrimLevelFor, relativeLuminance } from './legibility';

describe('scrimLevelFor', () => {
	it('a dark image needs only the light scrim', () => {
		expect(scrimLevelFor({ topLuminance: 0.1, bottomLuminance: 0.15 })).toBe('light');
	});
	it('a mid image bumps to medium', () => {
		expect(scrimLevelFor({ topLuminance: 0.5, bottomLuminance: 0.55 })).toBe('medium');
	});
	it('a bright image needs the heavy (frosted) scrim', () => {
		expect(scrimLevelFor({ topLuminance: 0.9, bottomLuminance: 0.85 })).toBe('heavy');
	});
	it('takes the BRIGHTER of the two regions (top chrome is the weak point)', () => {
		// Dark caption zone but a blown-out top strip must NOT read as light.
		expect(scrimLevelFor({ topLuminance: 0.92, bottomLuminance: 0.1 })).toBe('heavy');
	});
});

describe('relativeLuminance', () => {
	it('is 0 for black and ~1 for white', () => {
		expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 5);
		expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 2);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `bun run test:convex -- legibility`
Expected: FAIL — module `./legibility` does not exist.

- [ ] **Step 3: Implement the pure decision.** Create `convex/legibility.ts`:

```ts
/**
 * Legibility decision for the full-bleed card face (redesign §6). PURE — no
 * network, no decode. The ingest action samples luminance of the top strip and
 * bottom third (where the chrome + caption sit) and asks this which scrim level
 * guarantees white-on-image contrast regardless of the photo.
 */

/** sRGB relative luminance (WCAG), inputs 0–255, output 0–1. */
export function relativeLuminance(r: number, g: number, b: number): number {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Thresholds on the BRIGHTER of the two sampled regions: the worse zone dictates
// the scrim so neither the top chrome nor the bottom caption can wash out.
const MEDIUM_AT = 0.4;
const HEAVY_AT = 0.7;

export function scrimLevelFor(input: {
	topLuminance: number;
	bottomLuminance: number;
}): 'light' | 'medium' | 'heavy' {
	const worst = Math.max(input.topLuminance, input.bottomLuminance);
	if (worst >= HEAVY_AT) return 'heavy';
	if (worst >= MEDIUM_AT) return 'medium';
	return 'light';
}
```

- [ ] **Step 4: Run the pure tests to verify they pass.**

Run: `bun run test:convex -- legibility`
Expected: PASS.

- [ ] **Step 5: Wire the sample into ingest.** In `convex/ingest.ts`, after an image clears `selectFreeImage`/`fetchBestImage` (i.e. just before it is attached to the article/card), fetch the `thumbnailUrl` bytes, decode, and sample. Implementation notes (carry these as real steps, not placeholders):
  - Add an internal helper `sampleScrim(thumbnailUrl): Promise<{ scrim, dominantColor? }>` that downloads the thumbnail, decodes pixels, averages `relativeLuminance` over the **top ~15%** and **bottom ~33%** rows, and calls `scrimLevelFor`. Use the decode path already available in the Convex runtime; if no decoder is bundled, add the lightest dependency that runs in the Convex action sandbox (record the choice in the commit).
  - On any fetch/decode failure, default `scrim: 'medium'` (the safe middle — never `light`, which would under-protect). Failure must NOT block the image from attaching.
  - Set `image.scrim` (and `dominantColor` when cheap to extract) on the object passed to `setCardImage` / written onto the article.

- [ ] **Step 6: Add a scrim backfill work-list + test.** In `convex/ingest.ts`, add `imagedWithoutScrim` (published cards where `image` is present but `image.scrim` is absent) mirroring `imagelessPublished`, and a `backfillScrim` action that samples + patches each. In `convex/ingest.test.ts`, add a convex-test asserting `imagedWithoutScrim` returns only cards that have an image and no scrim. (Pure-logic assertion; the decode itself is exercised in Step 8 smoke, not unit-tested.)

- [ ] **Step 7: Regenerate types and run the backend tests.**

Run: `npx convex codegen && bun run test:convex -- "legibility|ingest"`
Expected: codegen succeeds; tests PASS.

- [ ] **Step 8: Commit.**

```bash
git add convex/legibility.ts convex/legibility.test.ts convex/ingest.ts convex/ingest.test.ts convex/_generated
git commit -m "feat(images): compute per-card scrim level from luminance at ingest + backfill"
```

---

### Task 4: Image guarantee — hold cards without an image at publish

**Why:** Spec §3b decision: a card is not publishable without a free-licensed lead image; the feed never shows a degraded card. The fix is a publish gate, not a render-time guard. Cards that reach publish without an `image` are held in a non-feed status (`needs_review`) and picked up later by the existing image backfill (`backfillImages`), which promotes them once an image clears.

**Files:**

- Modify: `convex/generationPipeline.ts` (the auto-publish step) and/or `convex/generate.ts` (`setCardStatus` callers) — block `published` when `image` is absent.
- Test: `convex/generationPipeline.test.ts`
- Modify (regenerated): `convex/_generated/*`

**Interfaces:**

- Produces: the publish path refuses to set `status:'published'` on an imageless card (holds it at `needs_review`); `backfillImages` promotes held cards once an image attaches.
- Consumes: existing `image` presence on the card; the `cardStatus` union (already has `needs_review`).

- [ ] **Step 1: Write the failing test.** In `convex/generationPipeline.test.ts`, add a convex-test that runs the auto-publish step on (a) a validated card WITH an image → ends `published`, and (b) an otherwise-identical card with NO image → ends `needs_review` (held), and asserts the held card does not appear in `cards:feed`/`feed.unseen`.

- [ ] **Step 2: Run it to verify it fails.**

Run: `bun run test:convex -- generationPipeline`
Expected: FAIL — the imageless card currently publishes.

- [ ] **Step 3: Add the gate.** In the publish step, branch on `card.image`: when absent, set `needs_review` (with a log line: "held — no free-licensed image") instead of `published`. Ensure `backfillImages` (Task 3 / existing) re-publishes a held card once it attaches an image.

- [ ] **Step 4: Run the test to verify it passes; regenerate types.**

Run: `npx convex codegen && bun run test:convex -- generationPipeline`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add convex/generationPipeline.ts convex/generate.ts convex/generationPipeline.test.ts convex/_generated
git commit -m "feat(generation): hold cards from publishing until a free image is attached"
```

---

### Task 5: Card face — full-bleed image + scrim layers + accent on payoff

**Why:** The face is the heart of the redesign (spec §3a, §6). Restructure `Card.svelte` so the image is the background (`.card-face`) with caption (kicker → hook → teaser → payoff) bottom-left over the layered scrim, and move the accent from the kicker to the payoff. This task builds the **static face only**; the depth sheet (Task 6) and rail/gestures (Task 7) layer on after.

**Files:**

- Modify: `src/app.css` (new `.card-face`, `.scrim`, `.scrim-top`, `.face-caption`, `.kicker`, `.payoff`; rework `.card`/`.card-image`; add `[data-scrim='heavy']` frosted-plate rule)
- Modify: `src/lib/components/Card.svelte`
- Test: `src/lib/components/Card.svelte.spec.ts`

**Interfaces:**

- Consumes: `card.image` (now with `scrim`), `card.format` (kicker), `card.hook`, `card.body` (teaser = first line / clamp), `card.whyItMatters` (payoff).
- Produces: the `.card-face` + scrim DOM that Task 6's sheet and Task 7's rail attach to; `data-scrim` attribute reflecting `card.image.scrim ?? 'medium'`.

- [ ] **Step 1: Write the failing tests.** Update `src/lib/components/Card.svelte.spec.ts` — the redesign changes the card's structure, so several existing assertions (inline body always visible, inline chips, inline why-toggle/source-toggle on the face) move to Task 6. Add face tests:

```ts
test('renders a full-bleed image as the card face when present', async () => {
	render(Card, { card: withImage });
	await expect.element(page.getByRole('img', { name: sample.hook })).toBeInTheDocument();
});

test('the hook and the "why it matters" payoff are legible on the face with zero taps', async () => {
	render(Card, { card: withImage });
	await expect.element(page.getByRole('heading', { name: sample.hook })).toBeVisible();
	await expect.element(page.getByText(WHY)).toBeVisible(); // payoff is on the face now
});

test('reflects the stored scrim level on the face for the legibility stack', async () => {
	const heavy = {
		...withImage,
		image: { ...withImage.image, scrim: 'heavy' }
	} as unknown as Doc<'knowledgeCards'>;
	render(Card, { card: heavy });
	const face = document.querySelector('.card-face') as HTMLElement;
	expect(face.getAttribute('data-scrim')).toBe('heavy');
});

test('defaults to the medium scrim when the level is unknown', async () => {
	render(Card, { card: withImage }); // no scrim field
	const face = document.querySelector('.card-face') as HTMLElement;
	expect(face.getAttribute('data-scrim')).toBe('medium');
});
```

(Hoist a `withImage` fixture at the top of the file from `sample` + an `image` object, as in the existing image test. Keep `WHY`/`SOURCE_SPAN`.)

- [ ] **Step 2: Run to verify they fail.**

Run: `bun run test:component -- Card`
Expected: FAIL — no `.card-face`, payoff not on the face.

- [ ] **Step 3: Restructure the face markup.** In `src/lib/components/Card.svelte`, replace the current `<figure class="card-image">` + `.card-body` structure with a full-bleed face. Skeleton (exact copy/values tuned in Task 9):

```svelte
<article class="card">
	<div class="card-face" data-scrim={card.image?.scrim ?? 'medium'}>
		{#if card.image}
			<img class="face-img" src={card.image.thumbnailUrl} alt={card.hook} loading="lazy" />
		{/if}
		<div class="scrim" aria-hidden="true"></div>
		<div class="scrim-top" aria-hidden="true"></div>

		<!-- bottom-left caption -->
		<div class="face-caption">
			<span class="kicker">{formatName(card.format)}</span>
			<h2 class="hook" title={card.hook}>{card.hook}</h2>
			<p class="teaser">{card.body}</p>
			{#if card.whyItMatters}
				<p class="payoff">{card.whyItMatters}</p>
			{/if}
		</div>
	</div>
	<!-- Task 6 inserts the depth sheet + page dots here; Task 7 the rail. -->
</article>
```

- [ ] **Step 4: Build the legibility CSS stack.** In `src/app.css`, add the layered scrim (§6: darken tint + bottom directional gradient + lighter top gradient + text-shadow), and the `[data-scrim]` ramp. Skeleton:

```css
.card-face {
	position: relative;
	height: 100%;
	overflow: hidden;
	isolation: isolate;
}
.face-img {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: cover;
}
/* 1. flat darken caps max brightness; 2. bottom-heavy directional scrim */
.scrim {
	position: absolute;
	inset: 0;
	background: rgba(0, 0, 0, 0.28), linear-gradient(to top, rgba(0, 0, 0, 0.86) 0%, transparent 62%);
}
/* lighter top scrim behind the top-right chrome (the weak point, §6) */
.scrim-top {
	position: absolute;
	inset: 0 0 auto;
	height: 22%;
	background: linear-gradient(to bottom, rgba(0, 0, 0, 0.45), transparent);
}
.face-caption {
	position: absolute;
	inset: auto 0 0 0;
	padding: var(--space-4);
	color: #fff; /* theme-independent: white-on-scrim in BOTH themes */
	text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55); /* 3. glyph-edge insurance */
}
.kicker {
	/* dropped to MUTED — accent moved to payoff */
	color: rgba(255, 255, 255, 0.7);
	text-transform: uppercase;
	letter-spacing: 0.04em;
}
.payoff {
	/* the single warm moment per card */
	border-inline-start: 3px solid var(--accent);
	padding-inline-start: var(--space-2);
	color: #fff;
}
/* scrim ramp: medium darkens the gradient, heavy adds the frosted plate (§6.5) */
.card-face[data-scrim='medium'] .scrim {
	background: rgba(0, 0, 0, 0.38), linear-gradient(to top, rgba(0, 0, 0, 0.92) 0%, transparent 68%);
}
.card-face[data-scrim='heavy'] .face-caption {
	background: rgba(0, 0, 0, 0.55);
	backdrop-filter: blur(8px);
	border-radius: 12px 12px 0 0;
}
```

(Use the existing `--space-*`, `--fs-*`, `--accent` tokens. The face replaces the old `.card-body` flow; remove the one-screen-fit body-clip CSS that no longer applies to the face — the teaser line-clamps instead. Keep the `prefers-reduced-motion` block untouched.)

- [ ] **Step 5: Run the face tests to verify they pass.**

Run: `bun run test:component -- Card`
Expected: PASS for the new face tests. (Sheet/rail-dependent tests are added/restored in Tasks 6–7.)

- [ ] **Step 6: Commit.**

```bash
git add src/app.css src/lib/components/Card.svelte src/lib/components/Card.svelte.spec.ts
git commit -m "feat(card): full-bleed image face with layered legibility scrim; accent on payoff"
```

---

### Task 6: Depth sheet ("page 2") — single/double-tap, page dots, relocated chips/source/Follow

**Why:** Depth moves off the face into one sheet (spec §3c, §4): single-tap opens/closes it; double-tap is reserved for like (Task 7). The sheet holds full body, concept chips (still re-rank), source quote/link/license (the relocated attribution), the "more like this" dive, and the Topic + `＋ Follow` row. Page dots track face ↔ depth. The sheet is the only theme-aware surface and must not grow the slot (snap integrity).

**Files:**

- Modify: `src/lib/components/Card.svelte` (generalize `.reveal-overlay` → `.depth-sheet`; tap disambiguation; page dots; Follow + chips + source + more inside)
- Modify: `src/app.css` (`.depth-sheet`, `.page-dots`, sheet theming)
- Test: `src/lib/components/Card.svelte.spec.ts`

**Interfaces:**

- Consumes: `card.body`, `card.conceptTags`, `card.source.*`, `card.whyItMatters`; new props `following: boolean`, `onFollow?: () => void` (Follow relocates here from the rail, spec §5), plus existing `onRelated`, `onMore`, `onSource`, `onExpand`.
- Produces: `open: boolean` sheet state; single-tap toggles it and fires `onExpand` once on first open (the new strong "go deeper" signal). Inner controls `stopPropagation` so they don't close the sheet.

- [ ] **Step 1: Write the failing tests.** In `Card.svelte.spec.ts`, restore the relocated affordances as sheet tests and add tap behavior:

```ts
test('single tap opens the depth sheet (full body, chips, source) and fires onExpand once', async () => {
	let expands = 0;
	render(Card, { card: withImage, onExpand: () => (expands += 1) });
	await expect.element(page.getByText(sample.body)).not.toBeVisible(); // body lives in the sheet now

	await page.getByRole('article').click(); // single tap on the face
	await expect.element(page.getByText(sample.body)).toBeVisible();
	await expect.element(page.getByRole('link', { name: /Wikipedia/ })).toBeVisible();
	expect(expands).toBe(1);

	await page.getByRole('article').click(); // tap again closes
	await expect.element(page.getByText(sample.body)).not.toBeVisible();
	expect(expands).toBe(1); // not re-fired on close
});

test('concept chips live in the sheet and re-rank via onRelated without closing it', async () => {
	const tags: string[] = [];
	render(Card, { card: withImage, onRelated: (t) => tags.push(t) });
	await page.getByRole('article').click();
	await page.getByRole('button', { name: 'Oxford' }).click(); // a conceptTag
	expect(tags).toEqual(['Oxford']);
	await expect.element(page.getByText(sample.body)).toBeVisible(); // chip tap did NOT close the sheet
});

test('the Topic + Follow row lives in the sheet and toggles follow', async () => {
	const fn = vi.fn();
	render(Card, { card: withImage, following: false, onFollow: fn });
	await page.getByRole('article').click();
	const follow = page.getByRole('button', { name: /follow/i });
	await follow.click();
	expect(fn).toHaveBeenCalledOnce();
});
```

(Import `vi` from `vitest`. `getByRole('article')` targets the card root for the tap.)

- [ ] **Step 2: Run to verify they fail.**

Run: `bun run test:component -- Card`
Expected: FAIL — single-tap doesn't open a sheet; chips/source/Follow not in a sheet.

- [ ] **Step 3: Implement the sheet + tap handling.** In `Card.svelte`:
  - Replace the `reveal` enum with a single `let open = $state(false)`; a `toggleSheet()` that fires `onExpand?.()` only on `false → true` and flips `open`.
  - **Tap vs double-tap disambiguation (spec §8):** a click handler on the article that ignores the second click of a double-tap. Use a ~230ms timer: on click, if a pending timer exists treat as double-tap (cancel the open — Task 7 wires like there); else set a timer that, on expiry, calls `toggleSheet()`. Keep it small and documented.
  - Render the sheet (generalized `.reveal-overlay` → `.depth-sheet`, still `position:absolute`, doesn't grow the slot) containing, in order: full `card.body`; **Topic + Follow** row (`{formatName}`/`card.source.articleTitle` + a `＋ Follow` button bound to `following`/`onFollow`); concept chips (`onRelated`); "More like this" (`onMore`); Source blockquote + Wikipedia link + license line (the relocated attribution).
  - Every interactive element inside the sheet calls `e.stopPropagation()` so taps inside don't bubble to the article's open/close handler.
  - Add page dots (`.page-dots`, two dots, active reflects `open`).

- [ ] **Step 4: Style the sheet.** In `src/app.css`, add `.depth-sheet` (slides up, `position:absolute`, max-height bounded, internally scrollable, **theme-aware** — reads `--bg`/`--text`, unlike the face), `.page-dots`, and the Follow row. Honor `prefers-reduced-motion` for the slide.

- [ ] **Step 5: Run to verify they pass.**

Run: `bun run test:component -- Card`
Expected: PASS — face tests (Task 5) + sheet tests.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/components/Card.svelte src/app.css src/lib/components/Card.svelte.spec.ts
git commit -m "feat(card): single-tap depth sheet — body, chips, source, Topic+Follow; page dots"
```

---

### Task 7: Bottom-right rail + double-tap like; free the horizontal swipe axis

**Why:** Taste signal claims the rail and the double-tap (spec §4–5). `CardActions` is repurposed into a bottom-right vertical rail of **like · dislike · save · share** (Follow having moved into the sheet in Task 6). Double-tap on the face also likes (heart burst). `swipeActions` loses its save/dismiss behavior so the horizontal axis is free and can never collide with the vertical feed.

**Files:**

- Modify: `src/lib/components/CardActions.svelte` (Follow → like+dislike; keep save+share)
- Test: `src/lib/components/CardActions.svelte.spec.ts`
- Modify: `src/lib/components/Card.svelte` (double-tap → `onLike`; heart-burst)
- Modify: `src/lib/actions/swipeActions.ts` (remove save/dismiss commit; keep the axis-lock scaffolding inert or strip it)
- Test: `src/lib/components/Card.svelte.spec.ts`

**Interfaces:**

- `CardActions` props become `{ liked, disliked, onLike, onDislike, saved, onSave, onShare? }` (Follow removed). `like`/`dislike` are mutually exclusive + reversible.
- `Card` gains `onLike?: () => void`; double-tap (the second click within ~230ms) fires it instead of opening the sheet.

- [ ] **Step 1: Write the failing rail tests.** Rewrite `CardActions.svelte.spec.ts` for the new rail: assert like, dislike, save, share buttons all render with accessible labels and fire their handlers; assert like/dislike reflect `liked`/`disliked` via `aria-pressed`; keep the ≥44px tap-target test (update the removed Follow button reference). Add to `Card.svelte.spec.ts`:

```ts
test('double-tap on the face likes without opening the sheet', async () => {
	let likes = 0;
	let expands = 0;
	render(Card, { card: withImage, onLike: () => (likes += 1), onExpand: () => (expands += 1) });
	const article = page.getByRole('article');
	await article.dblclick();
	expect(likes).toBe(1);
	await expect.element(page.getByText(sample.body)).not.toBeVisible(); // sheet did NOT open
	expect(expands).toBe(0);
});
```

- [ ] **Step 2: Run to verify they fail.**

Run: `bun run test:component -- "Card|CardActions"`
Expected: FAIL — no like/dislike on the rail; double-tap doesn't like.

- [ ] **Step 3: Rebuild the rail.** In `CardActions.svelte`, replace the Follow button with **like** (heart, fills when `liked`) and **dislike** (👎, fills when `disliked`); keep save + share. Mutually-exclusive/reversible is enforced by the parent (Task 8); the component just renders state + fires handlers. Update labels/`aria-pressed`.

- [ ] **Step 4: Wire double-tap like.** In `Card.svelte`, in the tap-disambiguation handler from Task 6, the double-tap branch calls `onLike?.()` (and triggers a heart-burst animation, reduced-motion-aware) and must NOT open the sheet.

- [ ] **Step 5: Free the horizontal axis.** In `src/lib/actions/swipeActions.ts`, remove the save/dismiss commit logic (the `onSave`/`onDismiss` calls, the fly-off animation). Either delete the action and its usage in `+page.svelte` (Task 8) or reduce it to a no-op that still hands all gestures back to native scroll. Update its doc comment to record that the horizontal axis is now deliberately free (spec §4).

- [ ] **Step 6: Run to verify they pass.**

Run: `bun run test:component -- "Card|CardActions"`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/components/CardActions.svelte src/lib/components/CardActions.svelte.spec.ts src/lib/components/Card.svelte src/lib/components/Card.svelte.spec.ts src/lib/actions/swipeActions.ts
git commit -m "feat(card): like/dislike/save/share rail + double-tap like; free the horizontal axis"
```

---

### Task 8: Feed page wiring — dislike-advances, like-stays, Follow-in-sheet, signal rename, drop card chrome

**Why:** `+page.svelte` is the integration point. It must: emit `like`/`dislike` events; make **dislike advance** to the next card while **like does not** (spec §5); pass `following`/`onFollow` into the `Card` sheet (Follow moved off the rail); keep "more like this" / focus-concept working through the sheet; stop placing streak/session chrome relative to the card; and remove the now-inert `swipeActions` usage.

**Files:**

- Modify: `src/routes/+page.svelte`
- Modify (maybe): `src/lib/telemetry.ts` (allow `like`/`dislike` track types if the event union is typed there)

**Interfaces:**

- Consumes: `api.events` (`like`/`dislike` via `track`), existing `api.saved.toggle`, `api.interests.add/remove`, `api.embeddings.forCard`, `scrollByViewport`.
- Produces: `handleLike(card)` (track `like`, toggle liked state, **no advance**), `handleDislike(card)` (track `dislike`, optimistic hide + `scrollByViewport(1)`), `following`/`onFollow` threaded into `<Card>`, `CardActions` wired to like/dislike/save/share.

- [ ] **Step 1: Write/extend the page-level test.** If there is a `+page` integration test, assert dislike advances and like doesn't; otherwise this behavior is covered by the component tests (Tasks 6–7) plus the Task 9 manual confirmation. Add unit coverage for any extracted pure helper (e.g. mutual-exclusion of like/dislike) under `src/lib/`.

- [ ] **Step 2: Wire like/dislike.** In `+page.svelte`:
  - Add `liked`/`disliked` state (a `SvelteSet` each, or reuse the events as source of truth). `handleLike` tracks `like` and toggles; `handleDislike` tracks `dislike`, adds to `notInterested` (optimistic hide, reusing the existing mechanism), and calls `scrollByViewport(1)` — replacing `handleNotInterested`'s role. Keep the `cooldownGate` on dislike (it advances, same double-fire risk).
  - Like does **not** call `scrollByViewport`.
  - Map the old `not_interested` keyboard shortcut (`x`) to `handleDislike`.

- [ ] **Step 3: Move Follow into the sheet.** Pass `following={followedSlugs.has(toSlug(card.source.articleTitle))}` and `onFollow={() => toggleFollow(card)}` into `<Card>` (Task 6's props), and **remove** `following`/`onFollow` from the `<CardActions>` usage. Wire `<CardActions>` to `onLike`/`onDislike`/`onSave`/`onShare` for the active card.

- [ ] **Step 4: Signal rename.** The sheet-open `onExpand` already fires `track('card_expand', ...)` — keep the event name (back-compat) but note in a comment it is now the sheet-open signal (spec §5). No new event needed beyond Task 2's like/dislike.

- [ ] **Step 5: Remove the inert swipe + confirm chrome.** Remove the `use:swipeActions={...}` block from the slot (Task 7 freed the axis). The streak/session HUD (`.hud`) stays where it is — it is page chrome, not card chrome — but confirm nothing in the card references streak/session (spec §2 non-goal). Keep the transient milestone toasts.

- [ ] **Step 6: Regenerate types if needed and run the full component + unit suite.**

Run: `bun run test:component && bun run test:unit`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/routes/+page.svelte src/lib/telemetry.ts
git commit -m "feat(feed): like/dislike wiring (dislike advances), Follow in sheet, drop swipe-to-act"
```

---

### Task 9: Legibility regression + full verify + visual confirmation

**Files:** `src/lib/components/Card.svelte.spec.ts` (legibility regression) + verification (no new source).

- [ ] **Step 1: Legibility regression test (spec §8).** In a browser component test, render the face over synthetic **Bright** and **Busy** backgrounds (a near-white `data:` image and a high-contrast checker) at each stored `scrim` level, and assert the caption text zone and the top-right chrome zone meet a contrast floor. Practical assertion in `vitest-browser-svelte`: confirm the `.scrim`/`.scrim-top` layers are present and that `[data-scrim='heavy']` applies the frosted plate (`backdrop-filter`/opaque background) — i.e. the deterministic stack escalates with the stored level. (True pixel-contrast sampling is the Step 3 manual check; the unit test guards the structural guarantee.)

- [ ] **Step 2: Full offline gate.**

Run: `bun run verify; echo "EXIT=$?"`
Expected: `EXIT=0` (check + lint + unit + convex + component). Do NOT pipe through `tail`.

- [ ] **Step 3: Visual confirmation in a browser** (`bun run dev`, phone-sized viewport). Confirm each spec acceptance:
  - **Zero-tap legibility:** hook + payoff readable at a glance on a Bright, a Busy, and a Dark image. The top-right chrome stays legible (the §6 weak point).
  - **One-gesture depth:** single-tap opens the sheet (body, chips, source, Topic+Follow); tap-again or grip closes; page dots track. Tap vs double-tap doesn't feel laggy (≈230ms); if it does, add a dedicated open affordance (spec §8) and re-verify.
  - **Taste signal:** double-tap likes (heart burst) and does **not** advance; rail like/dislike/save/share all work; **dislike advances** to the next card; like/dislike are mutually exclusive + reversible.
  - **Snap integrity:** opening the sheet does not scroll the feed; vertical swipe still moves one card per snap; horizontal swipe does nothing (axis free).
  - **Theme:** the face is identical white-on-scrim in light & dark; only the sheet themes.
  - **Image guarantee:** the feed shows no imageless cards (held at `needs_review`).
  - Inner sheet taps (chips, source link, Follow) do not close the sheet.

  Capture a screenshot of a Bright-image card with the sheet open for review. If a card's top chrome washes out, the lever is the §6 luminance thresholds (Task 3 `MEDIUM_AT`/`HEAVY_AT`) or the `.scrim-top` strength — adjust and re-verify.

- [ ] **Step 4: Commit any incidental tuning.**

```bash
git add -A
git commit -m "chore(card): tune scrim thresholds + tap timing after visual check" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**

- Full-bleed single card type, caption bottom-left, chrome top-right (§3a) → Task 5. ✅
- Accent moves kicker → payoff (§3a, decision 6) → Task 5 (`.kicker` muted, `.payoff` accent). ✅
- Every card has an image; pipeline enforces it (§3b, decision 9; "hold" over fallback) → Task 4. ✅
- Depth sheet "page 2": body, chips, source, Topic+Follow; page dots; theme-aware; inner taps don't close (§3c, §5, §8) → Task 6. ✅
- Gesture map — vertical=feed, single-tap=open/close, double-tap=like, horizontal free (§4) → Tasks 6 (tap), 7 (double-tap + free axis). ✅
- Signal model — like/dislike soft + reversible + mutually exclusive; dislike absorbs not-interested and advances; like doesn't advance; sheet-open = deepening signal (§5) → Tasks 2 (deltas), 7 (rail/double-tap), 8 (advance/no-advance + `card_expand` rename). ✅
- Follow lives in the sheet, not the face (§5, decision 10) → Tasks 6 (sheet row) + 8 (removed from rail). ✅
- "More like this" / concept re-rank consolidates into the sheet (§5, decision 11) → Task 6 (chips + dive in sheet) + 8 (handlers threaded). ✅
- Legibility = darken + directional scrim + top scrim + text-shadow + per-card luminance level + frosted-plate escape hatch; top strip is the weak point (§6, decision 8) → Task 1 (field), Task 3 (compute), Task 5 (render stack), Task 9 (regression). ✅
- No streak/session chrome on the card; keep milestone toasts (§2, decision 7) → Task 8 Step 5. ✅
- Schema: `image.scrim` + optional `image.dominantColor` (§7) → Task 1. ✅
- Testing considerations (§8): tap/double-tap disambiguation, legibility regression, image-guarantee, sheet theming, inner-tap stopPropagation, like/dislike reversibility, snap integrity → Tasks 6–9. ✅

**Deviations (intentional):**

- **`card_expand` event name reused** for sheet-open rather than introducing a new event — the spec says sheet-open "replaces today's `card_expand`"; reusing the name preserves historical-event continuity in personalization with no migration. (Task 8 Step 4.)
- **`not_interested` event retained** in `EVENT_DELTA` (Task 2) even though the UI now emits `dislike` — historical rows still carry it; removing the delta would silently drop their negative signal. The UI simply stops producing new ones.
- **Like delta (`+2`) softer than save (`+3`)**; dislike (`-3`) softer than `not_interested` (`-4`) — honoring §5 "weighted softly (an accidental tap isn't catastrophic)" for the accident-prone double-tap. Values are tunable.
- **Scrim default is `medium`, never `light`, on unknown/failed luminance** (Tasks 1, 3, 5) — under-protecting legibility is the worse failure; `medium` is the safe middle.

**Open question carried from the spec (§3b "Still open"):** hold vs. fallback background for the no-image case. This plan implements **hold** (decision default), via `needs_review` + existing image backfill (Task 4). If holding starves feed supply in practice, revisit with a deterministic branded fallback — flagged for the human at execution handoff.

**Placeholder scan:** The luminance _decode_ in Task 3 Step 5 is specified as real steps (download thumbnail → decode → sample top/bottom → `scrimLevelFor`) with a named decoder-choice decision and a `medium` failure default, not a stub — but it is the one step whose exact API depends on what decoder runs in the Convex action sandbox; the implementer must pick and record it. Everything else is concrete. The large Svelte/CSS rewrites (Tasks 5–7) give the markup skeleton, state model, class names, and full test contracts; exact CSS values (gradient stops, timing) are deliberately tuned against real images in Task 9 Step 3, mirroring the one-screen-fit plan's visual-tuning step.

**Type consistency:** `image.scrim` union (`'light'|'medium'|'heavy'`) defined in Task 1, written by Task 3, read by Task 5 (`data-scrim`), regression-tested in Task 9. `eventType` gains `'like'|'dislike'` (Task 2) consumed by `track` in Task 8. `Card` props grow `onLike?`, `following`, `onFollow` (Tasks 6–7) supplied by `+page.svelte` (Task 8). `CardActions` props change from `{saved,onSave,following,onFollow,onNotInterested,onShare?}` to `{liked,disliked,onLike,onDislike,saved,onSave,onShare?}` consistently across the component (Task 7), its spec (Task 7 Step 1), and its call site (Task 8 Step 3).
