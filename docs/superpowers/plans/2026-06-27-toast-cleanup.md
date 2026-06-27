# Toast Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every toast in the app; replace the share copy-confirmation with an inline Share-button state ("Copied" + check, ~1.5 s), and make all other cases silent.

**Architecture:** Add an optional `justCopied` prop to the `CardActions` Share button; the feed page drives it from `handleShare`; the `/c/[id]` page gets a local equivalent. Then delete the `toast.svelte.ts` util and its `.toast` CSS — nothing else uses them.

**Tech Stack:** SvelteKit + Svelte 5 (runes), vitest + vitest-browser-svelte, bun.

## Global Constraints

- **No toasts remain.** No new global/inline notification system.
- **Inline copy confirmation:** Share button shows a check icon + label "Copied" + `aria-label="Link copied"` for ~**1500 ms** on `shareCard` → `'copied'`, then reverts. `'shared'` and `'cancelled'` show nothing; `'failed'` → `console.error` only.
- **Silent elsewhere:** the empty-dive case does nothing; the dive error keeps its existing `console.error`.
- **Check-icon SVG path** (verbatim, stroke style): `M5 13l4 4L19 7`.
- **Existing share-icon SVG path** (keep, verbatim): `M12 15V4M12 4 8.5 7.5M12 4l3.5 3.5M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6`.
- Timers must be cleared on component teardown (`onDestroy`) and reset if copy repeats before expiry.
- Use `bun run` / `bunx`, never npm/npx. `vitest` sets `requireAssertions: true`.

---

### Task 1: `CardActions` — `justCopied` prop on the Share button (TDD)

**Files:**

- Modify: `src/lib/components/CardActions.svelte`
- Test: `src/lib/components/CardActions.svelte.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `CardActions` accepts `justCopied?: boolean` (default `false`). When true, the Share button's accessible name is "Link copied" and its label reads "Copied". The feed page (Task 2) passes this prop.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/components/CardActions.svelte.spec.ts`:

```ts
test('share button shows the copied state when justCopied is set', async () => {
	render(CardActions, { ...base, onShare: noop, justCopied: true });
	await expect.element(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
});

test('share button reads "Share" when justCopied is not set', async () => {
	render(CardActions, { ...base, onShare: noop });
	await expect.element(page.getByRole('button', { name: 'Share' })).toBeVisible();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:component -- CardActions`
Expected: FAIL — the `name: 'Link copied'` button isn't found (the Share button's `aria-label` is always "Share"), and `justCopied` isn't a prop yet.

- [ ] **Step 3: Add the prop**

In the `$props()` destructure of `src/lib/components/CardActions.svelte`, add `justCopied`:

```ts
let {
	liked,
	onLike,
	disliked,
	onDislike,
	saved,
	onSave,
	onShare,
	justCopied = false
}: {
	liked: boolean;
	onLike: () => void;
	disliked: boolean;
	onDislike: () => void;
	saved: boolean;
	onSave: () => void;
	onShare?: () => void;
	justCopied?: boolean;
} = $props();
```

- [ ] **Step 4: Make the Share button reflect it**

Replace the existing `{#if onShare} … {/if}` Share button block with:

```svelte
{#if onShare}
	<button
		type="button"
		class="action share"
		aria-label={justCopied ? 'Link copied' : 'Share'}
		title={justCopied ? 'Link copied' : 'Share'}
		onclick={onShare}
	>
		{#if justCopied}
			<svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
				<path
					d="M5 13l4 4L19 7"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		{:else}
			<svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
				<path
					d="M12 15V4M12 4 8.5 7.5M12 4l3.5 3.5M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		{/if}
		<span class="vh">{justCopied ? 'Copied' : 'Share'}</span>
	</button>
{/if}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run test:component -- CardActions`
Expected: PASS — all CardActions tests green (the existing 3 + the 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/CardActions.svelte src/lib/components/CardActions.svelte.spec.ts
git commit -m "feat(share): inline copied state on the CardActions share button"
```

---

### Task 2: Feed page — drive `justCopied`, silence the rest, drop the toast

**Files:**

- Modify: `src/routes/+page.svelte`

**Interfaces:**

- Consumes: `CardActions`'s `justCopied?: boolean` (Task 1).
- Produces: nothing for later tasks.

- [ ] **Step 1: Replace `handleShare` with the inline-copied version**

In `src/routes/+page.svelte`, replace:

```ts
async function handleShare(card: Doc<'knowledgeCards'>) {
	const result = await shareCard(card._id, card.hook);
	if (result === 'copied') toast.show('Link copied');
	else if (result === 'failed') toast.show('Could not share');
}
```

with:

```ts
let shareCopied = $state(false);
let shareCopiedTimer: ReturnType<typeof setTimeout> | null = null;
async function handleShare(card: Doc<'knowledgeCards'>) {
	const result = await shareCard(card._id, card.hook);
	if (result === 'copied') {
		shareCopied = true;
		if (shareCopiedTimer) clearTimeout(shareCopiedTimer);
		shareCopiedTimer = setTimeout(() => (shareCopied = false), 1500);
	} else if (result === 'failed') {
		console.error('[share] failed');
	}
	// 'shared' (OS sheet confirmed) and 'cancelled' show nothing.
}
```

- [ ] **Step 2: Add teardown cleanup**

Ensure `onDestroy` is imported from `svelte` (add `import { onDestroy } from 'svelte';` with the other imports if not already present), and add near the other lifecycle code:

```ts
onDestroy(() => {
	if (shareCopiedTimer) clearTimeout(shareCopiedTimer);
});
```

- [ ] **Step 3: Silence the dive cases**

Replace the empty-result branch and the catch's toast. Change:

```ts
			const fresh = related.filter((r) => !notInterested.has(r._id));
			if (fresh.length === 0) {
				toast.show('No related cards yet — keep exploring');
			} else {
				injectedAfter.set(card._id, fresh);
				scheduleAdapt();
				await tick();
				scrollByViewport(1);
			}
		} catch (err) {
			// A rate-limited dive is silently dropped (unreachable for a human at 30/min);
			// the existing error surfaces only for genuine failures.
			if (!isRateLimited(err)) {
				console.error('[feed] more-like-this failed', err);
				toast.show('Could not load related cards');
			}
		} finally {
```

to:

```ts
			const fresh = related.filter((r) => !notInterested.has(r._id));
			if (fresh.length > 0) {
				injectedAfter.set(card._id, fresh);
				scheduleAdapt();
				await tick();
				scrollByViewport(1);
			}
			// Empty result: do nothing — tapping again is harmless.
		} catch (err) {
			// A rate-limited dive is silently dropped; genuine failures are logged.
			if (!isRateLimited(err)) console.error('[feed] more-like-this failed', err);
		} finally {
```

- [ ] **Step 4: Pass the prop and remove the toast machinery**

- Add `justCopied={shareCopied}` to the `<CardActions … />` usage (next to `onShare={() => handleShare(activeCard)}`).
- Remove the toast render block:
  ```svelte
  {#if toast.message}
  	{#key toast.id}
  		<div class="toast" role="status" data-testid="toast">{toast.message}</div>
  	{/key}
  {/if}
  ```
- Remove `const toast = createToast();` and the `import { createToast } from '$lib/toast.svelte';` line.

- [ ] **Step 5: Verify**

Run: `bun run verify`
Expected: green. Then confirm no toast residue in this file:
Run: `grep -n "toast\|createToast" src/routes/+page.svelte`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat(share): inline copied state on the feed; silence dive/error toasts"
```

---

### Task 3: Share page (`/c/[id]`) inline confirm + delete the toast util & CSS

**Files:**

- Modify: `src/routes/c/[id]/+page.svelte`
- Delete: `src/lib/toast.svelte.ts`
- Modify: `src/app.css` (remove `.toast` + `@keyframes toast-in`)

**Interfaces:**

- Consumes: nothing.
- Produces: nothing (final task).

- [ ] **Step 1: Replace `onShare` with a local copied state**

In `src/routes/c/[id]/+page.svelte`, replace:

```ts
const toast = createToast();
async function onShare() {
	if (!card) return;
	const r = await shareCard(card._id, card.hook);
	if (r === 'copied') toast.show('Link copied');
	else if (r === 'failed') toast.show('Could not share');
}
```

with:

```ts
let copied = $state(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
async function onShare() {
	if (!card) return;
	const r = await shareCard(card._id, card.hook);
	if (r === 'copied') {
		copied = true;
		if (copiedTimer) clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 1500);
	} else if (r === 'failed') {
		console.error('[share] failed');
	}
}
onDestroy(() => {
	if (copiedTimer) clearTimeout(copiedTimer);
});
```

Add `import { onDestroy } from 'svelte';` to the script imports, and remove `import { createToast } from '$lib/toast.svelte';`.

- [ ] **Step 2: Reflect the copied state on the Share button**

Replace the `.share-btn` block:

```svelte
<button type="button" class="share-btn" onclick={onShare}>
	<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
		<path
			d="M12 15V4M12 4 8.5 7.5M12 4l3.5 3.5M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
	Share
</button>
```

with:

```svelte
<button
	type="button"
	class="share-btn"
	onclick={onShare}
	aria-label={copied ? 'Link copied' : 'Share'}
>
	{#if copied}
		<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
			<path
				d="M5 13l4 4L19 7"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
		Copied
	{:else}
		<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
			<path
				d="M12 15V4M12 4 8.5 7.5M12 4l3.5 3.5M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
		Share
	{/if}
</button>
```

- [ ] **Step 3: Remove the toast render block**

Delete from `src/routes/c/[id]/+page.svelte`:

```svelte
{#if toast.message}
	{#key toast.id}
		<div class="toast" role="status">{toast.message}</div>
	{/key}
{/if}
```

- [ ] **Step 4: Delete the now-orphaned util and CSS**

- Delete `src/lib/toast.svelte.ts`.
- In `src/app.css`, remove the `.toast { … }` rule (its block comment included) AND the `@keyframes toast-in { … }` block (used only by `.toast`).

- [ ] **Step 5: Verify nothing references the removed util/CSS**

Run: `grep -rn "createToast\|toast.svelte\|\.toast\b\|toast-in" src`
Expected: no output (no remaining references anywhere).

- [ ] **Step 6: Run the full suite**

Run: `bun run verify`
Expected: green (typecheck + lint + unit + convex + component).

- [ ] **Step 7: Commit**

```bash
git add src/routes/c/[id]/+page.svelte src/app.css
git rm src/lib/toast.svelte.ts
git commit -m "feat(share): inline copied state on /c/[id]; delete the toast util + CSS"
```

---

## Self-Review

**Spec coverage** (against `2026-06-27-toast-cleanup-design.md`):

- Share copy → inline button confirmation (check + "Copied" ~1.5 s, aria-label "Link copied") → Task 1 (CardActions) + Task 2 (feed wiring) + Task 3 (`/c/[id]`) ✓
- `'shared'`/`'cancelled'` show nothing; `'failed'` → console.error → Task 2 + Task 3 ✓
- Empty-dive silent; dive error keeps console.error → Task 2 Step 3 ✓
- Remove toast instances + render blocks (both files) → Task 2 Step 4, Task 3 Steps 1/3 ✓
- Delete `toast.svelte.ts` + remove `.toast` CSS (and `@keyframes toast-in`) → Task 3 Step 4 ✓
- Timer cleared on teardown / reset on repeat → Task 2 Step 2, Task 3 Step 1 ✓
- a11y: aria-label flips to "Link copied" → Task 1 + Task 3 ✓
- No test asserts toast text; data-testid block removed → Task 2 Step 4 ✓

**Placeholder scan:** every code step shows exact code (full SVG paths, exact strings). ✓

**Type/name consistency:** `justCopied?: boolean` defined in Task 1 is exactly the prop passed in Task 2 (`justCopied={shareCopied}`). The check-icon path `M5 13l4 4L19 7` and share-icon path are identical across CardActions (Task 1) and `/c/[id]` (Task 3). `shareCopied`/`shareCopiedTimer` (feed) and `copied`/`copiedTimer` (`/c/[id]`) are each self-consistent within their file. ✓
