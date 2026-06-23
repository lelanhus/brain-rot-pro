# One-Screen Fit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every feed card compose to exactly one viewport so it's a single clean scroll-snap stop — no clipped-without-affordance text, no intra-card scrolling.

**Architecture:** Turn the card into a height-bounded flex column (`.slot` height:100dvh → `.card`/`.card-body` flex columns) where the body is the flexible region that clips with a fade, the hook line-clamps, and the image is capped by a viewport-responsive `dvh` clamp. A minimal `ResizeObserver` in `Card.svelte` shows a "Read more" only when the body actually clips, opening the full body in the existing `.reveal-overlay`.

**Tech Stack:** Svelte 5 (runes: `$state`/`$effect`), global CSS in `src/app.css`, Vitest + `vitest-browser-svelte` (component tests run in a REAL browser — ResizeObserver and layout work).

## Global Constraints

- **One-screen-fit only** — no hook-length-at-generation change, no image-tone guard (both out of scope).
- **Attribution caption must never be clipped** — the image license caption (ADR-005) stays visible; cap the `<img>` height, never clip the `<figure>`.
- **No new motion** — fade mask is static; do not touch the existing `prefers-reduced-motion` block.
- **Progressive enhancement** — with no JS, the body still clamps via `overflow:hidden`; "Read more" is additive.
- **Body is already generation-capped** at `BODY_MAX_CHARS = 480` (`convex/generateLogic.ts`); the main overflow driver is image + long hook, so clipping is the exception.
- **bun** is the package runner; component tests: `bun run test:component`; full gate: `bun run verify`.
- Branch before starting (we are on `main`): `git checkout -b feat/one-screen-fit`.

---

### Task 1: Height-bounded flex layout (`src/app.css`)

**Files:**

- Modify: `src/app.css` (`.slot`, `.card`, `.card-body`, `.card-image`, `.card-image img`, `.hook`, `.body`; add `.body[data-clipped='true']`, `.read-more`, `.body-full`)

**Interfaces:**

- Consumes: existing CSS custom properties (`--space-*`, `--fs-*`, `--dur-fast`, `--ease`, `--text-2`, `--text`, `--measure`).
- Produces: the CSS hooks Task 2 relies on — class `.read-more`, attribute selector `.body[data-clipped='true']`, class `.body-full` (full body inside the reveal overlay).

- [ ] **Step 1: Bound the slot to one viewport.** In `src/app.css`, in the `.slot` rule, change `min-height: 100dvh;` to `height: 100dvh;` (leave padding, `scroll-snap-align`, `touch-action` unchanged).

- [ ] **Step 2: Make the card a full-height flex column.** Replace the `.card` rule:

```css
.card {
	position: relative; /* positioning context for .reveal-overlay */
	width: 100%;
	max-width: 640px;
}
```

with:

```css
.card {
	position: relative; /* positioning context for .reveal-overlay */
	width: 100%;
	max-width: 640px;
	height: 100%;
	display: flex;
	flex-direction: column;
	min-height: 0;
}
```

- [ ] **Step 3: Make the body wrapper the flexible column.** Replace the `.card-body` rule:

```css
.card-body {
	display: flex;
	flex-direction: column;
}
```

with:

```css
.card-body {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
}
```

- [ ] **Step 4: Cap the image responsively (caption stays visible).** Replace the `.card-image` rule:

```css
.card-image {
	margin: 0 0 1.25rem;
}
```

with:

```css
.card-image {
	flex: 0 0 auto; /* never shrink the figure — its caption is the required license attribution (ADR-005) */
	margin: 0 0 1.25rem;
}
```

Then in `.card-image img`, change `max-height: 24dvh;` to `max-height: clamp(110px, 22dvh, 24dvh);` (the `dvh` makes the image yield height on short viewports; the caption below it is never clipped). Leave `object-fit: cover` and the rest unchanged.

- [ ] **Step 5: Line-clamp the hook as a safety net.** In the `.hook` rule, add these four declarations (keep all existing ones):

```css
display: -webkit-box;
-webkit-box-orient: vertical;
-webkit-line-clamp: 5;
overflow: hidden;
```

- [ ] **Step 6: Make the body the shrink-and-clip region, with a fade when clipped.** In the `.body` rule, add:

```css
flex: 0 1 auto;
min-height: 0;
overflow: hidden;
```

(`flex-grow:0` keeps short cards' existing whitespace; `flex-shrink:1` + `min-height:0` + `overflow:hidden` lets a long body clip instead of overflowing the card.) Then add a new rule immediately after `.body`:

```css
/* Fade the bottom edge only when the body is actually clipped, so truncation
   reads as "more below" — set by Card.svelte's ResizeObserver via data-clipped. */
.body[data-clipped='true'] {
	-webkit-mask-image: linear-gradient(to bottom, #000 78%, transparent);
	mask-image: linear-gradient(to bottom, #000 78%, transparent);
}
```

- [ ] **Step 7: Add the "Read more" and overlay full-body styles.** Add these two rules (place `.read-more` near `.why-toggle`, and `.body-full` near the `.reveal-overlay` rules):

```css
/* "Read more" — quiet text affordance matching .why-toggle, shown only when the
   body is clipped. No accent fill, 44px target. */
.read-more {
	align-self: flex-start;
	margin-top: var(--space-2);
	min-height: 44px;
	display: inline-flex;
	align-items: center;
	font: inherit;
	font-size: var(--fs-meta);
	color: var(--text-2);
	background: none;
	border: 0;
	padding: 0;
	cursor: pointer;
	transition: color var(--dur-fast) var(--ease);
}

.read-more:hover {
	color: var(--text);
}

/* Full body text when "Read more" opens it in the reveal overlay. */
.body-full {
	max-width: var(--measure);
	margin: var(--space-3) 0 0;
	font-size: var(--fs-body);
	line-height: 1.6;
	color: var(--text-2);
}
```

- [ ] **Step 8: Verify the stylesheet is well-formed and formatted.**

Run: `bunx prettier --check src/app.css && bun run check`
Expected: prettier reports no issues; `svelte-check` passes (0 errors). (Pure-CSS layout is validated visually in Task 3.)

- [ ] **Step 9: Commit.**

```bash
git add src/app.css
git commit -m "feat(feed): height-bounded one-screen card layout (image cap, hook clamp, body fit)"
```

---

### Task 2: "Read more" affordance + clip detection (`src/lib/components/Card.svelte`)

**Files:**

- Modify: `src/lib/components/Card.svelte`
- Test: `src/lib/components/Card.svelte.spec.ts`

**Interfaces:**

- Consumes: `.read-more`, `.body[data-clipped='true']`, `.body-full` from Task 1; the existing `reveal` overlay mechanism and `onExpand` prop.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing tests.** Append to `src/lib/components/Card.svelte.spec.ts`:

```ts
test('hook carries its full text as a title attribute (for the clamped case)', async () => {
	render(Card, { card: sample });
	await expect
		.element(page.getByRole('heading', { name: sample.hook }))
		.toHaveAttribute('title', sample.hook);
});

test('no "Read more" when the body fits', async () => {
	render(Card, { card: sample });
	await expect.element(page.getByRole('button', { name: /read more/i })).not.toBeInTheDocument();
});

test('shows "Read more" when the body is clipped and opens the full body overlay, firing onExpand once', async () => {
	let expands = 0;
	const longBody =
		'This is a deliberately long body sentence used to force clipping in the test harness. '.repeat(
			8
		);
	const longCard = { ...sample, body: longBody } as unknown as Doc<'knowledgeCards'>;
	render(Card, { card: longCard, onExpand: () => (expands += 1) });

	// Force the body's box smaller than its content so the ResizeObserver marks it clipped.
	const bodyEl = document.querySelector('.body') as HTMLElement;
	bodyEl.style.height = '24px';

	const btn = page.getByRole('button', { name: /read more/i });
	await expect.element(btn).toBeVisible();
	await btn.click();

	// Full body opens in the reveal overlay (Close button confirms the panel rendered).
	await expect.element(page.getByRole('button', { name: 'Close' })).toBeVisible();
	expect(expands).toBe(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `bun run test:component -- Card`
Expected: FAIL — no `title` on the hook, no "Read more" button, no clip detection.

- [ ] **Step 3: Add the reveal `'body'` state, clip detection, and toggle.** In the `<script>` of `src/lib/components/Card.svelte`:

Change the reveal state line:

```ts
let reveal = $state<'why' | 'source' | null>(null);
```

to:

```ts
let reveal = $state<'why' | 'source' | 'body' | null>(null);
```

Then add, after the `toggleSource` function:

```ts
// "Read more": the body clips when it can't fit the one-screen card. A
// ResizeObserver flags that so the affordance appears only when needed; the
// full body then opens in the same reveal overlay as why/source.
let bodyEl = $state<HTMLParagraphElement | undefined>(undefined);
let clipped = $state(false);
$effect(() => {
	const el = bodyEl;
	if (el === undefined || typeof ResizeObserver === 'undefined') return;
	const measure = () => {
		clipped = el.scrollHeight > el.clientHeight + 1;
	};
	const ro = new ResizeObserver(measure);
	ro.observe(el);
	measure();
	return () => ro.disconnect();
});
function toggleBody() {
	if (reveal !== 'body') onExpand?.(); // first open of the full body is a deepening signal
	reveal = reveal === 'body' ? null : 'body';
}
```

- [ ] **Step 4: Wire the markup.** In the template:

(4a) Add a `title` to the hook. Change:

```svelte
<h2 class="hook">{card.hook}</h2>
```

to:

```svelte
<h2 class="hook" title={card.hook}>{card.hook}</h2>
```

(4b) Bind the body element and reflect the clipped flag, then add the button. Change:

```svelte
<p class="body">{card.body}</p>
```

to:

```svelte
<p class="body" bind:this={bodyEl} data-clipped={clipped}>{card.body}</p>

{#if clipped}
	<button type="button" class="read-more" onclick={toggleBody}>Read more</button>
{/if}
```

(4c) Add the `'body'` branch to the overlay. Change:

```svelte
				{#if reveal === 'why'}
					<p class="why">{card.whyItMatters}</p>
				{:else}
```

to:

```svelte
				{#if reveal === 'why'}
					<p class="why">{card.whyItMatters}</p>
				{:else if reveal === 'body'}
					<p class="body-full">{card.body}</p>
				{:else}
```

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `bun run test:component -- Card`
Expected: PASS — all existing Card tests plus the three new ones (title, no-read-more-when-fits, read-more-opens-overlay-and-fires-onExpand).

- [ ] **Step 6: Commit.**

```bash
git add src/lib/components/Card.svelte src/lib/components/Card.svelte.spec.ts
git commit -m "feat(feed): Read more affordance for clipped bodies via reveal overlay"
```

---

### Task 3: Full verify + visual confirmation

**Files:** none (verification).

- [ ] **Step 1: Run the full offline gate.**

Run: `bun run verify; echo "EXIT=$?"`
Expected: `EXIT=0` (check + lint + unit + convex + component). Do NOT pipe through `tail` — it masks the exit code.

- [ ] **Step 2: Confirm the fit visually in a browser.** With the dev server running (`bun run dev`, http://localhost:5173), open the feed at a phone-sized viewport and load a card that has BOTH a lead image and a long (4+ line) hook — these were the overflow cases (e.g. a person card with a photo). Confirm:
  - the whole card — tag → hook → body → chips/why/source controls — fits within one viewport, with the floating action stack visible;
  - if the body is too long to fit, it fades at the bottom and a "Read more" button is present that opens the full body in the overlay;
  - the image attribution caption is visible (never clipped);
  - scrolling advances one whole card per snap (no intra-card scroll needed to reach the controls).

  Capture a screenshot of a long card for the review. If a card still overflows, the most likely lever is the `.card-image img` clamp ceiling (Step 4 of Task 1) or the hook `-webkit-line-clamp` count (Step 5) — adjust and re-verify.

- [ ] **Step 3: Confirm reduced-motion is unaffected.** In the browser devtools, emulate `prefers-reduced-motion: reduce` and confirm the feed still renders correctly (cards fit, "Read more" works, no errors) — the fit is layout, not motion, so it must be identical.

- [ ] **Step 4: Commit any incidental changes (e.g. a clamp tweak from Step 2).**

```bash
git add -A
git commit -m "chore(feed): tune one-screen fit after visual check" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**

- `.slot` height:100dvh + card/card-body flex column → Task 1 Steps 1–3. ✅
- Image yields → Task 1 Step 4. **Deviation (intentional, a correctness fix):** the spec described the image yielding via `figure { flex:0 1 }`; that would let the figure shrink and clip its `<figcaption>`, which is the required CC license attribution (ADR-005). The plan instead pins the figure (`flex:0 0`) and caps the `<img>` with a `dvh` clamp, so the image still yields on short viewports but the attribution caption is never clipped. ✅ (better-honors the attribution constraint)
- Hook line-clamp safety net + `title` for a11y → Task 1 Step 5, Task 2 Step 4a. ✅
- Body flexible + clip + fade mask → Task 1 Step 6. ✅ (uses `flex:0 1 auto` so short cards keep their whitespace — the spec said `1 1 auto`; `0 1` is the refinement that avoids stretching short bodies, which would have pushed controls to the screen bottom and reduced the intended calm. Still fits long cards via shrink.)
- Explore controls pinned → emerges from Task 1 Steps 2–3, 6 (controls are `flex:0 0` after the shrinkable body). ✅
- "Read more" only when clipped, opens full body in existing overlay → Task 2 Steps 3–4. ✅
- Progressive enhancement (no JS → clamp only) → Task 2 Step 3 (`typeof ResizeObserver === 'undefined'` guard; `clipped` stays false). ✅
- No new motion / reduced-motion untouched → no edits to that block; Task 3 Step 3 confirms. ✅
- Component tests for read-more, no-read-more, hook title → Task 2 Step 1. ✅

**Placeholder scan:** none — every code/CSS/test step is complete.

**Type consistency:** `reveal` extended to `'why' | 'source' | 'body' | null` in Task 2 Step 3 and used in Step 4c. `bodyEl: HTMLParagraphElement | undefined` bound to a `<p>` (Step 4b) and read in the effect (Step 3). `clipped: boolean` drives both `data-clipped` and the `{#if}` (Step 4b). `.read-more`/`.body[data-clipped='true']`/`.body-full` defined in Task 1 (Steps 6–7) and used in Task 2 (Step 4). Test sample type `Doc<'knowledgeCards'>` matches the existing spec file's imports.
