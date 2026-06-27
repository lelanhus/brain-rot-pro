# Wonderwell Rebrand (W1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every user-facing "Brain Rot Pro" / "Brain Rot" string with "Wonderwell", guarded by a filesystem regression test, leaving all internal identifiers untouched.

**Architecture:** Pure display-string swaps across the app shell, PWA manifest, service-worker offline page, share metadata, page titles, `/c/[id]` OpenGraph tags, and the two SVG icon `aria-label`s — plus a README/docs rebrand note. A single node-environment vitest guard (`src/lib/branding.spec.ts`) asserts each branded file carries "Wonderwell" and no "brain rot" literal, so the swap is verified atomically and regressions are caught by `bun run verify`.

**Tech Stack:** SvelteKit + Svelte 5, vitest (server project, node env), bun.

## Global Constraints

- **Public display name:** `Wonderwell` (no "Pro" suffix). Exact casing, one word.
- **Internal identifiers are OUT OF SCOPE and MUST NOT change:** `package.json` name stays `brain-rot-pro`; localStorage keys keep the `brp_` prefix (`brp_theme`, `brp_admin_token`); Convex deployment names unchanged. The pre-paint `localStorage.getItem('brp_theme')` read in `src/app.html` MUST stay exactly as-is.
- **Tagline — long form** (meta description + manifest description), verbatim:
  `A zero-friction feed for the endlessly curious — surprising, source-backed sparks of wonder. One more idea, always.`
- **Tagline — short form** (`/c/[id]` OG/description fallback), verbatim:
  `Surprising, source-backed sparks of wonder. One more idea, always.`
- The em dash in the long tagline is a literal `—` (U+2014); files are UTF-8.
- Icon **glyph paths are untouched** — only each `aria-label` changes.
- Use `bun run`, never `npm`/`npx`, for scripts.
- `vitest` config sets `requireAssertions: true` — every test body must assert.

---

### Task 1: Rebrand guard + swap every user-facing string

**Files:**
- Create: `src/lib/branding.spec.ts` (node/server-project test)
- Modify: `src/app.html`
- Modify: `static/manifest.webmanifest`
- Modify: `src/service-worker.ts` (the offline-page HTML string, ~line 30)
- Modify: `src/lib/share.ts:19`
- Modify: `src/routes/+page.svelte:560`
- Modify: `src/routes/c/[id]/+page.svelte` (lines ~20, ~22, ~29, ~32, ~46)
- Modify: `static/icon.svg:1`
- Modify: `static/favicon.svg:1`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the rebranded user-facing surface. Task 2 (docs) depends on nothing from this task except that the app strings are already "Wonderwell".

This is one cohesive deliverable (a partial rebrand is not reviewable as "done"), so all swaps land in one task and one commit, gated by one guard test.

- [ ] **Step 1: Write the failing guard test**

Create `src/lib/branding.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every user-facing file must carry the Wonderwell brand and no "Brain Rot"
// string. Internal files (package.json, brp_ storage keys, design docs kept
// as historical record) are intentionally excluded.
const BRANDED_FILES = [
	'src/app.html',
	'static/manifest.webmanifest',
	'src/service-worker.ts',
	'src/lib/share.ts',
	'src/routes/+page.svelte',
	'src/routes/c/[id]/+page.svelte',
	'static/icon.svg',
	'static/favicon.svg'
];

describe('Wonderwell branding', () => {
	for (const file of BRANDED_FILES) {
		it(`${file} uses the Wonderwell name, not Brain Rot`, () => {
			const content = readFileSync(file, 'utf8');
			expect(content).toContain('Wonderwell');
			expect(content.toLowerCase()).not.toContain('brain rot');
		});
	}
});
```

- [ ] **Step 2: Run the guard test to verify it fails**

Run: `bun run test:unit -- branding`
Expected: FAIL — every case fails `expect(content).toContain('Wonderwell')` (and/or the `not.toContain('brain rot')` assertion), because the files still say "Brain Rot Pro".

- [ ] **Step 3: Swap the app-shell + PWA + icon strings**

In `src/app.html`:
- Change the description meta to the long tagline:
  ```html
  		<meta
  			name="description"
  			content="A zero-friction feed for the endlessly curious — surprising, source-backed sparks of wonder. One more idea, always."
  		/>
  ```
- Change the apple web-app title:
  ```html
  		<meta name="apple-mobile-web-app-title" content="Wonderwell" />
  ```
- Leave the `localStorage.getItem('brp_theme')` script untouched.

In `static/manifest.webmanifest`, set:
```json
	"name": "Wonderwell",
	"short_name": "Wonderwell",
	"description": "A zero-friction feed for the endlessly curious — surprising, source-backed sparks of wonder. One more idea, always.",
```
(Leave `start_url`, `scope`, colors, `categories`, and `icons` unchanged.)

In `src/service-worker.ts`, in the offline-page HTML string change the paragraph:
```html
<p>Wonderwell needs a connection for fresh cards.<br>Reconnect and we'll pick up where you left off.</p>
```

In `static/icon.svg` line 1 and `static/favicon.svg` line 1, change only the label:
```html
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Wonderwell">
```
(Do not touch any `<path>`/glyph markup.)

- [ ] **Step 4: Swap the titles + share + OG strings**

In `src/lib/share.ts` line ~19:
```ts
	const data: ShareData = { title: 'Wonderwell', text: hook, url };
```

In `src/routes/+page.svelte` line ~560:
```svelte
<svelte:head><title>Wonderwell</title></svelte:head>
```

In `src/routes/c/[id]/+page.svelte`:
- Fallback title (line ~20):
  ```ts
  	const title = $derived(card ? card.hook : 'Wonderwell');
  ```
- Fallback description (line ~22):
  ```ts
  	const description = $derived(
  		card ? card.body.slice(0, 200) : 'Surprising, source-backed sparks of wonder. One more idea, always.'
  	);
  ```
- Title suffix (line ~29):
  ```svelte
  	<title>{title} · Wonderwell</title>
  ```
- og:site_name (line ~32):
  ```svelte
  	<meta property="og:site_name" content="Wonderwell" />
  ```
- Back-link text (line ~46):
  ```svelte
  		<a class="back" href={resolve('/')}>Wonderwell</a>
  ```

- [ ] **Step 5: Run the guard test to verify it passes**

Run: `bun run test:unit -- branding`
Expected: PASS — all 8 cases green.

- [ ] **Step 6: Run the full verify loop**

Run: `bun run verify`
Expected: green (typecheck + lint + unit + convex + component). If lint reflows the long tagline string, accept the formatter's output as long as the literal text is unchanged.

- [ ] **Step 7: Confirm no stray user-facing occurrences**

Run: `grep -rin "brain rot" src static | grep -vi "branding.spec"`
Expected: no output. (The only allowed remaining hit is the guard test's own assertion literal, which the `grep -v` filters out.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/branding.spec.ts src/app.html static/manifest.webmanifest \
  src/service-worker.ts src/lib/share.ts src/routes/+page.svelte \
  "src/routes/c/[id]/+page.svelte" static/icon.svg static/favicon.svg
git commit -m "feat(rebrand): swap user-facing strings to Wonderwell (W1)"
```

---

### Task 2: Rebrand README + docs index note

**Files:**
- Modify: `README.md` (title + first line)
- Modify: `docs/README.md` (title)

**Interfaces:**
- Consumes: nothing.
- Produces: docs that name the product "Wonderwell". Internal design docs (`architecture-decisions.md`, `release-gates.md`, etc.) are intentionally left verbatim as historical record.

- [ ] **Step 1: Update `README.md`**

Change the top heading and intro line:
```md
# Wonderwell

> formerly *Brain Rot Pro*

A zero-friction, AI-generated knowledge feed sourced from Wikipedia/Wikimedia — discrete, source-backed "one more idea" cards in an infinite vertical feed.
```
(Leave the rest of the README — stack line, quick start, layout — unchanged.)

- [ ] **Step 2: Update `docs/README.md`**

Change the top heading:
```md
# Wonderwell — Documentation

> formerly *Brain Rot Pro*

A zero-friction, AI-generated knowledge feed sourced from Wikipedia/Wikimedia.
```
(Leave the "Read in this order", "Current status", and "Running it" sections unchanged — they are historical record.)

- [ ] **Step 3: Confirm docs build/lint is unaffected**

Run: `bun run lint`
Expected: green (prettier + eslint). Markdown changes should not affect lint, but this confirms formatting is clean.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/README.md
git commit -m "docs(rebrand): rename product to Wonderwell in README + docs index (W1)"
```

---

## Self-Review

**Spec coverage** (against `2026-06-26-wonderwell-rebrand-design.md`):
- app.html (title + description) → Task 1 Step 3 ✓
- manifest (name/short_name/description) → Task 1 Step 3 ✓
- service-worker offline copy → Task 1 Step 3 ✓
- share.ts title → Task 1 Step 4 ✓
- +page.svelte title → Task 1 Step 4 ✓
- c/[id] (fallback title, fallback description, title suffix, og:site_name, back link) → Task 1 Step 4 ✓
- icon.svg + favicon.svg aria-label → Task 1 Step 3 ✓
- tests updated for display strings → no pre-existing test asserts the old name (verified); a new guard test is added instead → Task 1 Step 1 ✓
- README + docs/README note → Task 2 ✓
- Internal identifiers unchanged → Global Constraints + explicit "leave untouched" notes ✓
- Out-of-scope items (domain/OAuth, icon redesign, key rename, deep docs rewrite) → not present in any task ✓

**Placeholder scan:** No TBD/TODO; every code step shows exact strings. ✓

**Type/string consistency:** The guard test's `BRANDED_FILES` list matches exactly the files modified in Task 1; every listed file ends up containing the literal `Wonderwell` and no `brain rot` (case-insensitive). The `og:url`/`canonical` derivation from `data.origin` is intentionally left alone (out of scope, W2). ✓
