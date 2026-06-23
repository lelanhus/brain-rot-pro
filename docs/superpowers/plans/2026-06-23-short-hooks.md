# Short Hooks at Generation + Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap generated hooks at ~80 chars (hard ceiling 90) so each hook reads as a 2–3 line poster and the body shows by default, and backfill existing long-hook cards by reusing the proven regenerate flow.

**Architecture:** Tighten the hook in `generateLogic.ts` (schema `.max` + a prompt rule — generate short, never truncate a one-sentence hook). Extend the existing body-backfill work-list (`generateDb.overlongPublished`) to also match over-long hooks and pass a `hookCap` through `generate.backfillShortenOverlong`, which already suppresses + regenerates each oversized card through the auto-publish + validate + embed flow. A prerequisite Task 1 fixes a latent `curation.ts` type-inference bug that otherwise breaks `check` whenever `convex/_generated` is regenerated (which Tasks 3–4 require).

**Tech Stack:** Convex (internalQuery / action), Zod (`generatedCardSchema`), Vitest + convex-test. `convex/_generated` is committed in this repo and must be regenerated when function signatures change.

## Global Constraints

- **Hook target ~80 chars / 2–3 lines; hard ceiling `HOOK_MAX_CHARS = 90`** (mirror `BODY_MAX_CHARS = 480`).
- **Generate short, never truncate** — a hook is one sentence; enforce via schema `.max` + prompt, not post-trim.
- **Backfill reuses the existing flow** — extend `overlongPublished` + `backfillShortenOverlong`; do NOT build a new LLM pipeline.
- **`convex/_generated` is tracked and committed** — regenerate it (via `npx convex codegen`, which connects to the dev deployment) whenever a Convex function signature changes, and commit the result. The committed `_generated` must leave `bun run check` green.
- **bun** is the package runner. Full gate: `bun run verify` (do NOT pipe through `tail` — it hides the exit code).
- Branch before starting (we are on `main`): `git checkout -b feat/short-hooks`.

---

### Task 1: Unblock codegen — fix `curation.ts` circular type inference (prerequisite)

**Why:** `convex/curation.ts`'s `auditEphemeralPublished` action references its own module (`internal.curation.listPublishedSources` / `suppressCards`) inside its handler. With no explicit return type, TypeScript infers the handler's type via the `api` type that includes the action itself → a self-referential cycle. The currently-committed `convex/_generated` happens to be green, but any fresh `convex codegen` (which Tasks 3–4 require) regenerates `api.d.ts` into a state that surfaces the cycle as ~19 "implicitly has type 'any'" errors across all Convex-consuming files. An explicit handler return type breaks the cycle.

**Files:**

- Modify: `convex/curation.ts` (`auditEphemeralPublished` handler signature)
- Modify (regenerated): `convex/_generated/*`

**Interfaces:**

- Produces: `auditEphemeralPublished` with an explicit `Promise<...>` handler return type; a freshly-regenerated, green `convex/_generated`.

- [ ] **Step 1: Reproduce the failure.** Regenerate types and run check to see the cycle.

Run: `npx convex codegen && bun run check`
Expected: `check` FAILS with ~19 errors, several in `convex/curation.ts` ("'auditEphemeralPublished' implicitly has type 'any' ... referenced directly or indirectly in its own initializer").

- [ ] **Step 2: Add an explicit handler return type.** In `convex/curation.ts`, change the `auditEphemeralPublished` handler signature from:

```ts
	handler: async (ctx, { apply }) => {
```

to:

```ts
	handler: async (
		ctx,
		{ apply }
	): Promise<{
		scanned: number;
		distinctTopics: number;
		wouldSuppress: number;
		applied: number;
		samples: Array<{ title: string; count: number }>;
	}> => {
```

(The body is unchanged — it already returns exactly this shape.)

- [ ] **Step 3: Regenerate types and confirm check is green.**

Run: `npx convex codegen && bun run check`
Expected: `check` PASSES — `0 ERRORS`. The `curation.ts` errors and all the cascaded "implicitly any" errors are gone.

- [ ] **Step 4: Commit the fix and the regenerated types.**

```bash
git add convex/curation.ts convex/_generated
git commit -m "fix(curation): explicit return type on auditEphemeralPublished (unblock codegen)"
```

---

### Task 2: Cap the hook at generation (`generateLogic.ts`)

**Files:**

- Modify: `convex/generateLogic.ts` (add `HOOK_MAX_CHARS`; hook schema `.max`; `.describe`; prompt rule)
- Test: `convex/generateLogic.test.ts`

**Interfaces:**

- Consumes: existing `generatedCardSchema`, `buildGenerationPrompt`.
- Produces: `export const HOOK_MAX_CHARS = 90`; `generatedCardSchema.hook` capped at `HOOK_MAX_CHARS`; `buildGenerationPrompt` output containing a hook-length rule.

- [ ] **Step 1: Write the failing tests.** Append to `convex/generateLogic.test.ts` (add `HOOK_MAX_CHARS` and `generatedCardSchema` to the existing import from `./generateLogic` if not already imported):

```ts
describe('hook length', () => {
	it('HOOK_MAX_CHARS is 90', () => {
		expect(HOOK_MAX_CHARS).toBe(90);
	});

	it('generatedCardSchema rejects a hook over the cap', () => {
		const card = {
			hook: 'x'.repeat(200),
			body: 'a'.repeat(120),
			whyItMatters: 'because',
			format: 'object_story',
			conceptTags: ['t'],
			sourceSpan: 'a verbatim source span of sufficient length'
		};
		expect(generatedCardSchema.safeParse(card).success).toBe(false);
	});

	it('generatedCardSchema accepts a card with a short hook', () => {
		const card = {
			hook: 'Wombats produce cube-shaped poop, the only animal that does.',
			body: 'a'.repeat(120),
			whyItMatters: 'because',
			format: 'object_story',
			conceptTags: ['t'],
			sourceSpan: 'a verbatim source span of sufficient length'
		};
		expect(generatedCardSchema.safeParse(card).success).toBe(true);
	});

	it('buildGenerationPrompt instructs a short one-line hook', () => {
		const prompt = buildGenerationPrompt({ title: 'T', paragraphs: ['Para one.'] });
		expect(prompt).toMatch(/one short line/i);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `bun run test:convex -- generateLogic`
Expected: FAIL — `HOOK_MAX_CHARS` not exported; the 200-char hook currently passes (cap is 180); the prompt has no "one short line" rule.

- [ ] **Step 3: Implement the cap.** In `convex/generateLogic.ts`:

(3a) Add the constant next to `BODY_MAX_CHARS` (which reads `export const BODY_MAX_CHARS = 480;`):

```ts
/** Single source of truth for the one-screen hook cap (a 2–3 line poster). */
export const HOOK_MAX_CHARS = 90;
```

(3b) Change the `hook` field of `generatedCardSchema` from:

```ts
	hook: z
		.string()
		.min(8)
		.max(180)
		.describe('One scroll-stopping sentence; declarative, not clickbait.'),
```

to:

```ts
	hook: z
		.string()
		.min(8)
		.max(HOOK_MAX_CHARS)
		.describe('One short, scroll-stopping line (≤~80 chars); a poster headline, declarative, not clickbait.'),
```

(3c) In `buildGenerationPrompt`, add a hook rule. Change the existing line:

```ts
			'- The hook must be specific and true — never sensationalized or misleading.',
```

to:

```ts
			'- The hook must be specific and true — never sensationalized or misleading.',
			'- The hook is ONE short line — at most ~80 characters (~12 words). A poster headline, not a sentence of context.',
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `bun run test:convex -- generateLogic`
Expected: PASS — all existing generateLogic tests plus the four new ones.

- [ ] **Step 5: Commit.**

```bash
git add convex/generateLogic.ts convex/generateLogic.test.ts
git commit -m "feat(generation): cap hook at HOOK_MAX_CHARS=90 (schema + prompt)"
```

---

### Task 3: Backfill over-long hooks via the existing flow (`generateDb.ts` + `generate.ts`)

**Files:**

- Modify: `convex/generateDb.ts` (`overlongPublished` — add `hookCap`, OR-match hooks)
- Modify: `convex/generate.ts` (`backfillShortenOverlong` — add `hookCap`, pass through)
- Test: `convex/generateDb.test.ts`
- Modify (regenerated): `convex/_generated/*`

**Interfaces:**

- Consumes: `HOOK_MAX_CHARS` (Task 2); existing `setCardStatus`, `generateFromArticle`.
- Produces: `overlongPublished({ cap, hookCap, limit })` returning `{ _id, articleId }[]` for cards whose body OR hook exceeds its cap; `backfillShortenOverlong({ cap?, hookCap?, limit? })`.

- [ ] **Step 1: Write the failing test.** In `convex/generateDb.test.ts`, (a) update the existing `overlongPublished` call to pass `hookCap`, and (b) add a new test for hook-matching. First change the existing assertion call from:

```ts
const rows = await t.query(internal.generateDb.overlongPublished, { cap: 480, limit: 50 });
```

to:

```ts
const rows = await t.query(internal.generateDb.overlongPublished, {
	cap: 480,
	hookCap: 90,
	limit: 50
});
```

Then append this new test (it reuses the same `base`/`articleId` setup pattern as the existing test):

```ts
test('overlongPublished also matches cards whose hook exceeds the hook cap', async () => {
	const t = convexTest(schema, modules);
	const articleId = await t.run(async (ctx) =>
		ctx.db.insert('sourceArticles', {
			pageId: 9,
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
		body: 'short body',
		whyItMatters: 'w',
		format: 'object_story' as const,
		conceptTags: ['t'],
		shuffleKey: 0.5,
		createdAt: 0,
		source: { articleTitle: 'T', articleUrl: 'u', revisionId: 1 as number | null, sourceSpan: 's' },
		generation: {
			generationModel: 'gm',
			validationModel: 'vm',
			supportScore: 0.9,
			promptVersion: '1',
			sourceArticleId: articleId,
			generatedAt: 0
		}
	};
	await t.run(async (ctx) => {
		// (a) long hook + short body → matched
		await ctx.db.insert('knowledgeCards', {
			...base,
			hook: 'h'.repeat(150),
			status: 'published'
		});
		// (b) short hook + long body → matched
		await ctx.db.insert('knowledgeCards', {
			...base,
			hook: 'short',
			body: 'a'.repeat(600),
			status: 'published'
		});
		// (c) both short → not matched
		await ctx.db.insert('knowledgeCards', { ...base, hook: 'short', status: 'published' });
	});

	const rows = await t.query(internal.generateDb.overlongPublished, {
		cap: 480,
		hookCap: 90,
		limit: 50
	});
	expect(rows).toHaveLength(2);
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `bun run test:convex -- generateDb`
Expected: FAIL — `overlongPublished` doesn't accept `hookCap` (validator error) and/or doesn't match the long-hook card.

- [ ] **Step 3: Extend `overlongPublished`.** In `convex/generateDb.ts`, replace:

```ts
export const overlongPublished = internalQuery({
	args: { cap: v.number(), limit: v.number() },
	handler: async (ctx, { cap, limit }) => {
		const cards = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.collect();
		return cards
			.filter((c) => c.body.length > cap)
			.slice(0, limit)
			.map((c) => ({ _id: c._id, articleId: c.generation?.sourceArticleId ?? null }));
	}
});
```

with:

```ts
export const overlongPublished = internalQuery({
	args: { cap: v.number(), hookCap: v.number(), limit: v.number() },
	handler: async (ctx, { cap, hookCap, limit }) => {
		const cards = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.collect();
		return cards
			.filter((c) => c.body.length > cap || c.hook.length > hookCap)
			.slice(0, limit)
			.map((c) => ({ _id: c._id, articleId: c.generation?.sourceArticleId ?? null }));
	}
});
```

Also update the doc comment above it from "whose body exceeds the one-screen cap" to "whose body OR hook exceeds its one-screen cap".

- [ ] **Step 4: Thread `hookCap` through the backfill.** In `convex/generate.ts`, in `backfillShortenOverlong`:

(4a) Add `HOOK_MAX_CHARS` to the existing import from `./generateLogic` (which already imports `clampBody`).

(4b) Change the args from:

```ts
	args: { cap: v.optional(v.number()), limit: v.optional(v.number()) },
```

to:

```ts
	args: { cap: v.optional(v.number()), hookCap: v.optional(v.number()), limit: v.optional(v.number()) },
```

(4c) After `const cap = args.cap ?? 480;` add:

```ts
const hookCap = args.hookCap ?? HOOK_MAX_CHARS;
```

(4d) Change the query call from:

```ts
const rows = await ctx.runQuery(internal.generateDb.overlongPublished, { cap, limit });
```

to:

```ts
const rows = await ctx.runQuery(internal.generateDb.overlongPublished, { cap, hookCap, limit });
```

- [ ] **Step 5: Regenerate types and run the tests.**

Run: `npx convex codegen && bun run test:convex -- generateDb`
Expected: codegen succeeds; tests PASS (both overlong tests). (`codegen` updates `convex/_generated` for the new `overlongPublished`/`backfillShortenOverlong` arg shapes.)

- [ ] **Step 6: Commit (including regenerated types).**

```bash
git add convex/generateDb.ts convex/generate.ts convex/generateDb.test.ts convex/_generated
git commit -m "feat(generation): backfill over-long hooks via overlongPublished + backfillShortenOverlong"
```

---

### Task 4: Full verify + deploy + run the backfill

**Files:** none (verification + deploy + data backfill).

- [ ] **Step 1: Full offline gate.**

Run: `bun run verify; echo "EXIT=$?"`
Expected: `EXIT=0` (check + lint + unit + convex + component). If `check` shows the curation/"implicitly any" errors, Task 1 was not effective — stop and revisit.

- [ ] **Step 2: Deploy backend functions to the dev deployment.**

Run: `npx convex dev --once`
Expected: "Convex functions ready!" with no errors.

- [ ] **Step 3: Confirm new generation produces short hooks (optional smoke).** Generate one card and check its hook length.

Run: `npx convex run generate:generateBatch '{"limit":1}'`
Then inspect: `npx convex run cards:feed '{"paginationOpts":{"numItems":5,"cursor":null}}'` and confirm recently-created hooks are ≤ ~90 chars. (Generation is non-deterministic; this is a sanity check, not a gate.)

- [ ] **Step 4: Dry-run the backfill work-list size.** There is no dedicated dry-run flag, so first inspect how many cards are over-long without mutating, using a `limit: 0`-style check is not supported — instead run the backfill with a small `limit` and review the report before scaling up.

Run: `npx convex run generate:backfillShortenOverlong '{"limit":5}'`
Expected: a report `{ scanned, regenerated, suppressedOnly, failed }`. Review it: `regenerated` should be > 0 and the feed should now show shorter hooks for those topics. If `failed`/`suppressedOnly` dominate, stop and investigate before scaling.

- [ ] **Step 5: Scale the backfill once the small batch looks right.**

Run: `npx convex run generate:backfillShortenOverlong '{"limit":200}'`
Expected: the remaining over-long cards are regenerated (or suppressed if unrecoverable). Re-run until `scanned` reaches 0 / stabilizes.

- [ ] **Step 6: Commit any incidental regenerated types.**

```bash
git add -A
git commit -m "chore(generation): regen types after short-hook backfill" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**

- `HOOK_MAX_CHARS = 90` + schema cap + prompt rule → Task 2. ✅
- Generate-short-not-truncate (no clampHook) → Task 2 (schema + prompt only; no trim function). ✅
- Backfill reuses `backfillShortenOverlong` + extend `overlongPublished` with `hookCap` → Task 3. ✅
- Existing `overlongPublished` callers updated (backfill call + test) → Task 3 Steps 1, 4d. ✅
- Forward + backfill both covered; backfill run via `npx convex run` → Task 4. ✅
- Tests: HOOK_MAX_CHARS value, schema reject/accept, prompt rule, overlong hook-matching → Tasks 2–3. ✅
- **Added beyond spec (intentional, discovered prerequisite):** Task 1 fixes `curation.ts` circular inference. Without it, the `convex/_generated` regeneration that Tasks 3–4 require leaves `bun run check` red. The spec called this out only as a future "latent" note; it is a hard blocker for landing any backend-signature change with green verify, so it is pulled in here. Flag to the human at execution handoff.

**Placeholder scan:** none — every code/test step is complete. (Task 4 Step 4 notes the absence of a dry-run flag and uses a small `limit` as the safe first pass — explicit, not a placeholder.)

**Type consistency:** `HOOK_MAX_CHARS` defined in Task 2, consumed in Task 3 (Step 4a/4c). `overlongPublished({ cap, hookCap, limit })` signature consistent across Task 3 (impl, both test calls, backfill call). `backfillShortenOverlong({ cap?, hookCap?, limit? })` consistent. Return shape `{ _id, articleId }` unchanged (backfill only needs those).
