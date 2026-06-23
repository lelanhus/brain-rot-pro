# One-Screen Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every feed card fit within one viewport with no in-card scroll — swipe moves to the next card; content never scrolls within the current one.

**Architecture:** Bound the content at the source (cap the generated body length) and make each `.slot` a true `100dvh` box that physically cannot scroll (capped image, restored hook size, body clipped as a safety net). Secondary reveals (why-it-matters / source) open as an overlay that doesn't push content off-screen. A one-time backfill shortens legacy over-long cards.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), Convex, Zod (generation schemas), Vitest (unit/convex/component projects), Playwright (e2e, gated behind `E2E_LIVE`). Package manager: **bun**.

## Global Constraints

- Fit target: guarantee no-scroll fit on phones **≥ 375×667 dvh** (iPhone SE 2022+). 320×568 best-effort.
- Visible without any tap: hook + body + image + tags. "Why it matters" / "Source" / "More like this" are compact controls; their detail opens as a non-scrolling overlay.
- No horizontal scroll, ever (existing rule, `ui-ux.md`).
- Use existing design tokens (`--space-*`, `--fs-*`); document any numeric layout constant with its derivation (no bare magic numbers).
- Run commands with bun. Deploy: push to `main` → Vercel auto-deploys frontend; backend via `npx convex deploy` locally.
- Spec: `docs/superpowers/specs/2026-06-20-one-screen-cards-design.md`.

---

### Task 1: Cap generated body length

**Files:**

- Modify: `convex/generateLogic.ts` (body schema ~line 35-39; `buildGenerationPrompt` ~line 65-80)
- Test: `convex/generateLogic.test.ts` (existing `generatedCardSchema` describe block ~line 79)

**Interfaces:**

- Consumes: nothing new.
- Produces: `generatedCardSchema` now rejects `body.length > 480`. The auto-publish path (`generate.ts`) and the backfill (Task 4) rely on this cap holding.

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe('generatedCardSchema', ...)` block in `convex/generateLogic.test.ts`:

```ts
it('rejects a body longer than the one-screen cap (480)', () => {
	const card = {
		hook: 'A valid declarative hook.',
		body: 'a'.repeat(481),
		whyItMatters: 'It matters.',
		format: 'object_story',
		conceptTags: ['t'],
		sourceSpan: 'a'.repeat(30)
	};
	expect(generatedCardSchema.safeParse(card).success).toBe(false);
});

it('accepts a body exactly at the cap (480)', () => {
	const card = {
		hook: 'A valid declarative hook.',
		body: 'a'.repeat(480),
		whyItMatters: 'It matters.',
		format: 'object_story',
		conceptTags: ['t'],
		sourceSpan: 'a'.repeat(30)
	};
	expect(generatedCardSchema.safeParse(card).success).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run convex/generateLogic.test.ts`
Expected: the "rejects a body longer than the one-screen cap (480)" test FAILS (current max is 1400, so 481 chars currently passes).

- [ ] **Step 3: Lower the cap and tighten the prompt**

In `convex/generateLogic.ts`, change the `body` field:

```ts
	body: z
		.string()
		.min(80)
		.max(480)
		.describe('One tight paragraph (≈2–4 short sentences, ~80 words max) explaining the one idea, in plain language.'),
```

In `buildGenerationPrompt`, add this rule line to the `Rules:` list (after the "Teach exactly ONE idea" line):

```ts
		'- Keep the body to ONE tight paragraph: at most 3–4 short sentences (~80 words). Brevity is the format — a card is read in one screen, never scrolled.',
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run convex/generateLogic.test.ts`
Expected: PASS (all tests, including the existing 200-char body test which is still ≤ 480).

- [ ] **Step 5: Commit**

```bash
git add convex/generateLogic.ts convex/generateLogic.test.ts
git commit -m "feat: cap generated card body at 480 chars for one-screen fit"
```

---

### Task 2: Make each slot a true one-viewport box

**Files:**

- Modify: `src/app.css` (`:root` token `--fs-hook` ~line 28; `.slot` ~line 165; `.card` ~line 211; `.card-image img` ~line 233; `.body` ~line 303)
- Test: `e2e/feed.e2e.ts` (add a gated fit test)

**Interfaces:**

- Consumes: capped body from Task 1 (so the clip rarely engages on new cards).
- Produces: `.slot` never scrolls (`scrollHeight <= clientHeight`).

- [ ] **Step 1: Write the failing e2e test**

Append to `e2e/feed.e2e.ts`:

```ts
// One-screen guarantee: no card scrolls within its slot at the target phone
// sizes. Gated like the other SSR tests (needs live Convex + seeded cards).
test.describe('feed (one-screen fit)', () => {
	test.skip(!process.env.E2E_LIVE, 'requires a live Convex deployment (set E2E_LIVE=1)');

	for (const vp of [
		{ name: 'iPhone SE 2022', width: 375, height: 667 },
		{ name: 'iPhone 14', width: 390, height: 844 }
	]) {
		test(`no in-card scroll at ${vp.name}`, async ({ page }) => {
			await page.setViewportSize({ width: vp.width, height: vp.height });
			await page.goto('/');
			await expect(page.getByTestId('feed')).toBeVisible();
			const overflow = await page
				.locator('.slot')
				.evaluateAll((slots) =>
					slots.map((s) => s.scrollHeight - s.clientHeight).filter((d) => d > 1)
				);
			expect(overflow).toEqual([]);
		});
	}
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `E2E_LIVE=1 bunx playwright test e2e/feed.e2e.ts -g "one-screen fit"`
Expected: FAIL — at least one `.slot` overflows (current `.slot` is `min-height: 100dvh` and grows past it).

- [ ] **Step 3: Restore the hook size to spec**

In `src/app.css` `:root`, change `--fs-hook`:

```css
--fs-hook: clamp(1.6rem, 4.5vw, 2.3rem); /* spec size; was drifted to 3rem */
```

- [ ] **Step 4: Make `.slot` a fixed one-viewport box**

In `src/app.css`, change `.slot`: replace `min-height: 100dvh;` with `height: 100dvh;` and add `overflow: hidden;`. Keep the existing flex/padding/scroll-snap declarations. The block's leading comment should be updated to say the slot is exactly one viewport (it no longer grows past 100dvh).

- [ ] **Step 5: Let the card fill the slot and the body absorb/clip slack**

In `src/app.css`:

```css
.card {
	width: 100%;
	max-width: 640px;
	display: flex;
	flex-direction: column;
	flex: 1;
	min-height: 0; /* allow children to shrink instead of forcing overflow */
}
```

Make `.card-body` a flex column that can shrink, and the body the flexible region that clips rather than scrolls. Update `.card-body`:

```css
.card-body {
	display: flex;
	flex-direction: column;
	flex: 1;
	min-height: 0;
}
```

Update `.body` to clip overflow (safety net for legacy long bodies; new bodies are capped in Task 1 and won't clip):

```css
.body {
	font-size: var(--fs-body);
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden; /* clip, never scroll; legacy >480-char bodies are shortened in Task 4 */
}
```

- [ ] **Step 6: Cap the image height so it can't crowd out the text**

Update `.card-image img` in `src/app.css` to add a height cap:

```css
.card-image img {
	display: block;
	width: 100%;
	max-height: 30dvh; /* image never takes more than ~⅓ of the screen */
	object-fit: cover;
	border-radius: var(--radius);
}
```

(Keep any existing declarations in this rule that aren't listed here, e.g. border-radius if already present — do not duplicate.)

- [ ] **Step 7: Run the e2e test to verify it passes**

Run: `E2E_LIVE=1 bunx playwright test e2e/feed.e2e.ts -g "one-screen fit"`
Expected: PASS — no `.slot` overflows at 375×667 or 390×844.

- [ ] **Step 8: Manual check + commit**

Manually verify on `bun run dev` at a 375×667 window: a long card and an image card both fit with no in-card scroll; the next-card swipe still snaps.

```bash
git add src/app.css e2e/feed.e2e.ts
git commit -m "feat: pin each feed slot to one viewport (no in-card scroll)"
```

---

### Task 3: Open "why it matters" / "source" as a non-scrolling overlay

**Files:**

- Modify: `src/lib/components/Card.svelte` (the `why`/`source` reveals ~line 59-98)
- Modify: `src/app.css` (add overlay styles near `.why` ~line 356 and `.source` ~line 485)
- Test: `e2e/feed.e2e.ts` (extend the fit test to the opened state)

**Why:** With `.slot { overflow: hidden }` (Task 2), an inline expansion (the current `slide`/`<details>`) would clip the controls below it. An overlay keeps the card layout fixed, so opening a reveal never causes scroll.

**Interfaces:**

- Consumes: `.slot`/`.card` from Task 2.
- Produces: opening a reveal does not change `.slot` scrollHeight.

- [ ] **Step 1: Write the failing e2e assertion**

Add to `e2e/feed.e2e.ts` inside a new gated describe:

```ts
test.describe('feed (reveal overlay)', () => {
	test.skip(!process.env.E2E_LIVE, 'requires a live Convex deployment (set E2E_LIVE=1)');

	test('opening "why it matters" does not introduce scroll', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto('/');
		const slot = page.locator('.slot').first();
		await page.getByRole('button', { name: 'Why it matters' }).first().click();
		const overflow = await slot.evaluate((s) => s.scrollHeight - s.clientHeight);
		expect(overflow).toBeLessThanOrEqual(1);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `E2E_LIVE=1 bunx playwright test e2e/feed.e2e.ts -g "reveal overlay"`
Expected: FAIL — the inline `slide` expansion grows the card, so the slot overflows when opened.

- [ ] **Step 3: Render the reveal as an overlay panel**

In `src/lib/components/Card.svelte`, replace the inline `{#if expanded}<p class="why" ...>` reveal (and, optionally, fold the `<details class="source">` content into the same panel) with an absolutely-positioned panel. Minimal change for "why it matters":

```svelte
{#if card.whyItMatters}
	<button
		type="button"
		class="why-toggle"
		class:open={expanded}
		aria-expanded={expanded}
		onclick={toggleWhy}
	>
		Why it matters
		<span class="why-caret" aria-hidden="true"></span>
	</button>
{/if}
```

Then, as the LAST child of `<article class="card">` (after `.card-body`), add the overlay:

```svelte
{#if expanded}
	<div class="reveal-overlay" transition:fade={{ duration: 140 }}>
		<button type="button" class="reveal-close" onclick={() => (expanded = false)} aria-label="Close"
			>×</button
		>
		<p class="why">{card.whyItMatters}</p>
	</div>
{/if}
```

Add `import { fade } from 'svelte/transition';` and remove the now-unused `slide` import if "why" was its only user.

- [ ] **Step 4: Style the overlay (contained, non-scrolling, no layout shift)**

In `src/app.css`, make `.card` the positioning context (add `position: relative;` to the `.card` rule from Task 2) and add:

```css
/* Reveal panel: floats over the lower card area so opening it never changes the
   card's flow height (and thus never causes the slot to scroll). Content here is
   short (whyItMatters ≤ 360 chars), so it fits without internal scroll. */
.reveal-overlay {
	position: absolute;
	inset-inline: 0;
	bottom: 0;
	z-index: 2;
	padding: var(--space-4);
	background: color-mix(in srgb, var(--surface) 92%, transparent);
	backdrop-filter: blur(6px);
	border-top: 1px solid var(--border);
	border-radius: var(--radius) var(--radius) 0 0;
}
.reveal-close {
	float: right;
	font: inherit;
	font-size: 1.2rem;
	line-height: 1;
	color: var(--muted);
	background: none;
	border: none;
	cursor: pointer;
}
```

- [ ] **Step 5: Run the e2e assertion to verify it passes**

Run: `E2E_LIVE=1 bunx playwright test e2e/feed.e2e.ts -g "reveal overlay"`
Expected: PASS.

- [ ] **Step 6: Component test still green + manual check + commit**

Run: `bun run test:component` (ensure `Card.svelte.spec.ts` still passes; update it if it asserted the old inline `.why` behavior).
Manually verify on `bun run dev`: opening "why it matters" shows the panel over the card bottom, closes cleanly, and nothing scrolls.

```bash
git add src/lib/components/Card.svelte src/app.css src/lib/components/Card.svelte.spec.ts
git commit -m "feat: show why-it-matters as a non-scrolling overlay"
```

---

### Task 4: Backfill legacy over-long published cards

**Files:**

- Modify: `convex/generateDb.ts` (add `overlongPublished` internalQuery)
- Modify: `convex/generate.ts` (add `backfillShortenOverlong` action)
- Test: `convex/generateDb.test.ts` (create) or add to an existing convex test file for the query

**Approach:** New cards are already short (Task 1). For each already-published card whose body exceeds the cap, **suppress it then regenerate from its source article** — suppressing first means the fresh (short) card won't be dropped by the publish-time dedup check against the old one. Regeneration reuses the existing `generate.generateFromArticle` action unchanged.

**Interfaces:**

- Consumes: `generateFromArticle` (existing action: `({ articleId }) => { cardId, status, ... }`), the 480 cap from Task 1.
- Produces: `internal.generateDb.overlongPublished({ cap, limit }) => Array<{ _id: Id<'knowledgeCards'>; articleId: Id<'sourceArticles'> | null }>`.

- [ ] **Step 1: Write the failing query test**

Create `convex/generateDb.test.ts`:

```ts
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('overlongPublished returns only published cards over the cap', async () => {
	const t = convexTest(schema, modules);
	const articleId = await t.run(async (ctx) =>
		ctx.db.insert('sourceArticles', {
			pageId: 1,
			title: 'T',
			url: 'u',
			revisionId: 1,
			extract: '',
			paragraphs: ['p'],
			categories: [],
			status: 'fetched',
			fetchedAt: 0
		})
	);
	const base = {
		hook: 'h',
		whyItMatters: 'w',
		format: 'object_story' as const,
		conceptTags: ['t'],
		shuffleKey: 0.5,
		createdAt: 0,
		source: { articleId, articleTitle: 'T', articleUrl: 'u', sourceSpan: 's' }
	};
	await t.run(async (ctx) => {
		await ctx.db.insert('knowledgeCards', { ...base, body: 'a'.repeat(600), status: 'published' });
		await ctx.db.insert('knowledgeCards', { ...base, body: 'a'.repeat(100), status: 'published' });
		await ctx.db.insert('knowledgeCards', { ...base, body: 'a'.repeat(600), status: 'suppressed' });
	});

	const rows = await t.query(internal.generateDb.overlongPublished, { cap: 480, limit: 50 });
	expect(rows).toHaveLength(1);
	expect(rows[0].articleId).toBe(articleId);
});
```

NOTE: match the `knowledgeCards`/`sourceArticles` field shapes to `convex/schema.ts` exactly when writing this test — adjust the literal objects above if the schema requires more fields (e.g. `generation`, `image` are optional and omitted here).

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run convex/generateDb.test.ts`
Expected: FAIL — `internal.generateDb.overlongPublished` does not exist.

- [ ] **Step 3: Implement the query**

In `convex/generateDb.ts` add:

```ts
/** Published cards whose body exceeds the one-screen cap — the shorten work-list. */
export const overlongPublished = internalQuery({
	args: { cap: v.number(), limit: v.number() },
	handler: async (ctx, { cap, limit }) => {
		const cards = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.take(2000);
		return cards
			.filter((c) => c.body.length > cap)
			.slice(0, limit)
			.map((c) => ({ _id: c._id, articleId: c.source.articleId ?? null }));
	}
});
```

Ensure `internalQuery` and `v` are imported in `generateDb.ts` (add to existing imports if missing).

- [ ] **Step 4: Run it to verify it passes**

Run: `bunx vitest run convex/generateDb.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the backfill action**

In `convex/generate.ts` add (an `action`; `'use node'` is already at the top of the file):

```ts
/**
 * One-time: shorten legacy published cards whose body exceeds the one-screen cap.
 * Suppress the old card first (so the fresh short card isn't dropped by the
 * publish-time dedup), then regenerate from its source article.
 *   npx convex run generate:backfillShortenOverlong '{"limit":50}'
 */
export const backfillShortenOverlong = action({
	args: { cap: v.optional(v.number()), limit: v.optional(v.number()) },
	handler: async (
		ctx,
		args
	): Promise<{ scanned: number; regenerated: number; suppressedOnly: number }> => {
		const cap = args.cap ?? 480;
		const limit = args.limit ?? 50;
		const rows = await ctx.runQuery(internal.generateDb.overlongPublished, { cap, limit });
		let regenerated = 0;
		let suppressedOnly = 0;
		for (const row of rows) {
			await ctx.runMutation(internal.generateDb.setCardStatus, {
				cardId: row._id,
				status: 'suppressed'
			});
			if (!row.articleId) {
				suppressedOnly++;
				continue;
			}
			const r = await ctx.runAction(api.generate.generateFromArticle, { articleId: row.articleId });
			if (r.status === 'published') regenerated++;
			else suppressedOnly++;
		}
		return { scanned: rows.length, regenerated, suppressedOnly };
	}
});
```

If `internal.generateDb.setCardStatus` does not exist, add a small `internalMutation` in `generateDb.ts` that patches `status` on a card id (`args: { cardId: v.id('knowledgeCards'), status: cardStatus }`), importing `cardStatus` from `./schema`. Verify `api` and `internal` are imported in `generate.ts` (they are).

- [ ] **Step 6: Typecheck + commit (action verified at run time, not unit-tested)**

Run: `bun run check` → expect 0 errors. Run: `bunx vitest run convex/generateDb.test.ts` → PASS.

```bash
git add convex/generateDb.ts convex/generate.ts convex/generateDb.test.ts
git commit -m "feat: backfill to shorten legacy over-long cards"
```

---

### Task 5: Verify, deploy, and confirm on production

**Files:** none (release task).

- [ ] **Step 1: Full local verification**

Run: `bun run verify`
Expected: check + lint + unit + convex + component all PASS. (Pre-existing prettier warnings in vendored `.agents/`/`.claude/` files are unrelated; do not reformat them.)

- [ ] **Step 2: Push (frontend auto-deploys) and deploy backend**

```bash
git push origin main
bunx convex deploy -y
```

- [ ] **Step 3: Run the backfill once against production**

```bash
npx convex run generate:backfillShortenOverlong '{"limit":100}'
```

Re-run until `scanned` is 0 (each run handles up to `limit` cards).

- [ ] **Step 4: Confirm on the live site**

On `https://brain-rot-pro.vercel.app` at a 375×667 window: swipe several cards (with and without images) and confirm none scroll within the card; open "why it matters" and confirm no scroll appears. Run the gated e2e against prod if desired:
`E2E_LIVE=1 PUBLIC_CONVEX_URL=<prod-url> bunx playwright test e2e/feed.e2e.ts -g "one-screen fit"`.

- [ ] **Step 5: Final commit (if any test/doc tweaks were needed)**

```bash
git add -A && git commit -m "chore: one-screen cards verification tweaks" && git push origin main
```

---

## Self-Review

- **Spec coverage:** §1 content cap → Task 1. §2 layout (slot 100dvh, hook size, image cap, body clip, action-zone) → Task 2. §2 reveals as non-scrolling overlay → Task 3. §3 legacy regenerate/suppress → Task 4. §4 testing (fit assertion + cap unit test) → Tasks 1-3 tests + Task 5. ✓
- **Action-zone note:** Task 2 pins the slot and lets the body clip; the existing `--action-zone` bottom padding still reserves the rail's space, so an explicit trim is optional polish, not required for fit — folded into Step 5's flex sizing rather than a separate magic-number change.
- **Type consistency:** `overlongPublished({cap,limit}) → {_id, articleId}` is produced in Task 4 Step 3 and consumed in Task 4 Step 5; `generateFromArticle({articleId}) → {status,...}` matches `convex/generate.ts`. `setCardStatus` reused/added consistently.
- **Placeholders:** none; CSS/markup steps give concrete declarations, with visual validation called out where layout needs an eye.
