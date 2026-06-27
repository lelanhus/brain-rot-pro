# W4 Safety Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep sensitive/harmful Wikipedia articles out of the auto-published feed via a pure `classifySafety()` folded into the ingest chokepoint (`decideArticleStatus`), plus a backfill that suppresses already-published unsafe cards.

**Architecture:** A new pure `convex/safetyLogic.ts` classifies an article (categories + title + current year) under a **targeted** posture: always-block harm; block politics/legal/tragedy only when _current_; block advice-framed health. `decideArticleStatus` runs it first (safety wins over allow/block/ephemeral) so both ingest call sites inherit it and unsafe articles never reach generation. A `backfillSafety` action re-classifies published cards and flips unsafe ones to `suppressed`. Rank-time is structural — the feed already serves only `published`.

**Tech Stack:** Convex, vitest + convex-test, bun.

## Global Constraints

- **Targeted posture:** historical/evergreen science & politics & medicine STAY; only _current_ controversy, _advice-framed_ health, and _always-harmful_ content are blocked. When uncertain → `safe` (bias to keep).
- **`classifySafety` is pure and never throws.** Signature:
  `classifySafety({ categories: string[]; title: string; nowYear?: number }) → { safe: boolean; reason?: SafetyReason }`, `SafetyReason = 'harm' | 'active-politics' | 'ongoing-legal' | 'recent-tragedy' | 'medical-advice'`.
- **Recency rule:** politics/legal/tragedy block only when the category/title is _current_ — contains an "ongoing/current/incumbent/active" marker OR a 4-digit year `>= nowYear - 1`. `harm` and `medical-advice` are era-independent. When `nowYear` is absent, the recency-gated rules are skipped.
- **Ingest basis string:** unsafe → `{ status: 'filtered_out', basis: 'safety: <reason>' }`.
- **No schema change.** Reuse `'filtered_out'` (articles) and `'suppressed'` (cards). Backfill is dry-run unless `apply: true`, and reversible.
- Keyword lists are exported constants — starters, expected to be tuned against the live `decisions` log.
- Use `bun run` / `bunx`, never npm/npx. **No deploy** (`convex dev`/`codegen`) — held per the user; build + `bun run verify` offline. `vitest` sets `requireAssertions: true`.

---

### Task 1: `safetyLogic.ts` — the pure classifier (TDD)

**Files:**

- Create: `convex/safetyLogic.ts`
- Create: `convex/safetyLogic.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `classifySafety(...)` and `SafetyReason` (consumed by Task 2 + Task 3).

- [ ] **Step 1: Write the failing matrix test**

Create `convex/safetyLogic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifySafety } from './safetyLogic';

const NOW = 2026;

describe('classifySafety — keeps evergreen', () => {
	it('keeps anatomy / biology', () => {
		expect(
			classifySafety({ categories: ['Human anatomy', 'Organs'], title: 'Heart', nowYear: NOW }).safe
		).toBe(true);
	});
	it('keeps a historical war', () => {
		expect(
			classifySafety({
				categories: ['World War II', 'Battles of 1944'],
				title: 'Battle of Normandy',
				nowYear: NOW
			}).safe
		).toBe(true);
	});
	it('keeps historical politics (1860 election)', () => {
		expect(
			classifySafety({
				categories: ['United States presidential elections', '1860 elections'],
				title: '1860 United States presidential election',
				nowYear: NOW
			}).safe
		).toBe(true);
	});
});

describe('classifySafety — blocks harm (any era)', () => {
	it('blocks suicide', () => {
		const r = classifySafety({ categories: ['Suicide'], title: 'Suicide methods', nowYear: NOW });
		expect(r.safe).toBe(false);
		expect(r.reason).toBe('harm');
	});
	it('blocks even without nowYear', () => {
		expect(classifySafety({ categories: ['Terrorism'], title: 'Terrorist tactics' }).safe).toBe(
			false
		);
	});
});

describe('classifySafety — blocks current, keeps old', () => {
	it('blocks a current election', () => {
		const r = classifySafety({
			categories: ['2026 United States elections'],
			title: '2026 United States Senate elections',
			nowYear: NOW
		});
		expect(r.safe).toBe(false);
		expect(r.reason).toBe('active-politics');
	});
	it('blocks a recent tragedy', () => {
		const r = classifySafety({
			categories: ['Deaths in 2026', 'Disasters in 2026'],
			title: '2026 earthquake',
			nowYear: NOW
		});
		expect(r.safe).toBe(false);
		expect(r.reason).toBe('recent-tragedy');
	});
	it('keeps an old disaster', () => {
		expect(
			classifySafety({
				categories: ['1906 disasters', 'Earthquakes in 1906'],
				title: '1906 San Francisco earthquake',
				nowYear: NOW
			}).safe
		).toBe(true);
	});
});

describe('classifySafety — blocks advice-framed health', () => {
	it('blocks a medication', () => {
		const r = classifySafety({
			categories: ['Antidepressants', 'Medications'],
			title: 'Sertraline',
			nowYear: NOW
		});
		expect(r.safe).toBe(false);
		expect(r.reason).toBe('medical-advice');
	});
});

describe('classifySafety — degenerate input', () => {
	it('empty input is safe', () => {
		expect(classifySafety({ categories: [], title: '' }).safe).toBe(true);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test:convex -- safetyLogic`
Expected: FAIL — `./safetyLogic` does not exist.

- [ ] **Step 3: Implement `convex/safetyLogic.ts`**

```ts
export type SafetyReason =
	| 'harm'
	| 'active-politics'
	| 'ongoing-legal'
	| 'recent-tragedy'
	| 'medical-advice';

// Always blocked, any era (category/title substrings, lowercased). Tunable.
export const HARM_TERMS = [
	'suicide',
	'self-harm',
	'self harm',
	'pornograph',
	'sexual abuse',
	'child sexual',
	'terroris',
	'extremis',
	'neo-nazi',
	'white supremac',
	'hate group'
];

// Advice-framed health — blocked any era (advice risk regardless of date). Tight by design.
export const MEDICAL_ADVICE_TERMS = [
	'medications',
	'antidepressant',
	'medical treatment',
	'psychiatric medication',
	'dietary supplement',
	'drugs used to treat'
];

// Blocked only when the SAME category/title is *current* (recent year or marker).
export const POLITICS_TERMS = [
	'election',
	'electoral',
	'impeachment',
	'political scandal',
	'political controvers',
	'referendum',
	'civil unrest'
];
export const LEGAL_TERMS = ['litigation', 'lawsuit', 'court case', 'trial of', 'indictment'];
export const TRAGEDY_TERMS = [
	'disaster',
	'earthquake',
	'mass shooting',
	'massacre',
	'terrorist attack',
	'plane crash',
	'deaths in',
	'disease outbreak',
	'pandemic',
	'famine',
	'wildfire'
];

const ONGOING = /\bongoing\b|\bcurrent\b|\bincumbent\b|\bactive\s/;

function some(hay: string, terms: string[]): boolean {
	return terms.some((t) => hay.includes(t));
}

/** True when `s` reads as a *current* topic: an ongoing marker or a year >= nowYear-1. */
function isCurrent(s: string, nowYear: number | undefined): boolean {
	if (ONGOING.test(s)) return true;
	if (nowYear === undefined) return false;
	const years = s.match(/\b(20\d\d)\b/g);
	return years !== null && years.some((y) => Number(y) >= nowYear - 1);
}

/**
 * Targeted safety classification (W4). Harm + advice-framed health are blocked
 * regardless of era; politics / legal / tragedy are blocked only when current,
 * so historical science/politics/medicine stay. When uncertain → safe.
 */
export function classifySafety(args: { categories: string[]; title: string; nowYear?: number }): {
	safe: boolean;
	reason?: SafetyReason;
} {
	const fields = [...args.categories, args.title].map((s) => s.toLowerCase());
	const hay = fields.join(' || ');

	if (some(hay, HARM_TERMS)) return { safe: false, reason: 'harm' };
	if (some(hay, MEDICAL_ADVICE_TERMS)) return { safe: false, reason: 'medical-advice' };

	for (const field of fields) {
		if (!isCurrent(field, args.nowYear)) continue;
		if (some(field, POLITICS_TERMS)) return { safe: false, reason: 'active-politics' };
		if (some(field, LEGAL_TERMS)) return { safe: false, reason: 'ongoing-legal' };
		if (some(field, TRAGEDY_TERMS)) return { safe: false, reason: 'recent-tragedy' };
	}
	return { safe: true };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run test:convex -- safetyLogic`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add convex/safetyLogic.ts convex/safetyLogic.test.ts
git commit -m "feat(safety): pure classifySafety classifier (W4)"
```

---

### Task 2: Fold safety into `decideArticleStatus`

**Files:**

- Modify: `convex/wikidataLogic.ts` (`decideArticleStatus`, ~line 157)
- Test: `convex/wikidataLogic.test.ts`

**Interfaces:**

- Consumes: `classifySafety` (Task 1).
- Produces: `decideArticleStatus` now returns `filtered_out` / `basis: 'safety: <reason>'` for unsafe articles. Both ingest call sites (`ingest.ts:323`, `:368`) inherit it unchanged.

- [ ] **Step 1: Write the failing test**

Add to `convex/wikidataLogic.test.ts`:

```ts
import { classifySafety } from './safetyLogic';

test('decideArticleStatus filters an unsafe article before anything else', () => {
	const out = decideArticleStatus({
		verdict: { verdict: 'allow', reason: 'class disease' },
		categories: ['2026 United States elections'],
		title: '2026 United States Senate elections',
		nowYear: 2026
	});
	expect(out.status).toBe('filtered_out');
	expect(out.basis).toBe('safety: active-politics');
});

test('decideArticleStatus keeps a safe allowed article', () => {
	const out = decideArticleStatus({
		verdict: { verdict: 'allow', reason: 'class chemical element' },
		categories: ['Chemical elements'],
		title: 'Oxygen',
		nowYear: 2026
	});
	expect(out.status).toBe('fetched');
});
```

(If `decideArticleStatus`/`classifySafety` aren't yet imported in the test file, add the imports.)

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test:convex -- wikidataLogic`
Expected: FAIL — the election article currently returns `fetched` (the `allow` verdict), no safety check.

- [ ] **Step 3: Add the safety pre-check**

In `convex/wikidataLogic.ts`, add the import at the top:

```ts
import { classifySafety } from './safetyLogic';
```

Then make the safety check the FIRST thing in `decideArticleStatus`'s handler body (before the `nowYear`/ephemeral block):

```ts
const safety = classifySafety({
	categories: args.categories,
	title: args.title ?? '',
	nowYear: args.nowYear
});
if (!safety.safe) return { status: 'filtered_out', basis: `safety: ${safety.reason}` };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run test:convex -- wikidataLogic`
Expected: PASS — the unsafe article is `filtered_out` with `safety:` basis; the safe one stays `fetched`.

- [ ] **Step 5: Run the full suite**

Run: `bun run verify`
Expected: green. (Existing `decideArticleStatus`/ingest tests still pass — safe articles are unaffected; only genuinely unsafe inputs change.)

- [ ] **Step 6: Commit**

```bash
git add convex/wikidataLogic.ts convex/wikidataLogic.test.ts
git commit -m "feat(safety): block unsafe articles at the ingest chokepoint (W4)"
```

---

### Task 3: `backfillSafety` — suppress already-published unsafe cards

**Files:**

- Create: `convex/safety.ts`
- Test: `convex/safety.test.ts`

**Interfaces:**

- Consumes: `classifySafety` (Task 1); `internal.curation.suppressCards` (existing — `{ ids }` → `{ suppressed }`).
- Produces: `backfillSafety` internalAction (dry-run unless `apply: true`); an internal query joining published cards to their source categories.

- [ ] **Step 1: Write the failing test**

Create `convex/safety.test.ts`:

```ts
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('backfillSafety suppresses an unsafe published card and keeps safe ones', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.seed.seed, {});

	// Force one published card to look unsafe via its source title. Use an
	// era-INDEPENDENT harm term so the test never depends on nowYear.
	const target = await t.run(async (ctx) => {
		const card = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.first();
		if (!card) throw new Error('no published card seeded');
		await ctx.db.patch(card._id, {
			source: { ...card.source, articleTitle: 'Suicide methods' }
		});
		return card._id;
	});

	const dry = await t.action(internal.safety.backfillSafety, {});
	expect(dry.unsafe).toBeGreaterThanOrEqual(1);
	const stillPublished = await t.run(async (ctx) => (await ctx.db.get(target))?.status);
	expect(stillPublished).toBe('published'); // dry-run does not mutate

	const applied = await t.action(internal.safety.backfillSafety, { apply: true });
	expect(applied.suppressed).toBeGreaterThanOrEqual(1);
	const after = await t.run(async (ctx) => (await ctx.db.get(target))?.status);
	expect(after).toBe('suppressed');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test:convex -- safety`
Expected: FAIL — `internal.safety.backfillSafety` does not exist.

- [ ] **Step 3: Implement `convex/safety.ts`**

```ts
import { v } from 'convex/values';
import { internalAction, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { classifySafety } from './safetyLogic';

/** Published cards with their source title + categories (categories from the linked article). */
export const listPublishedForSafety = internalQuery({
	args: {},
	handler: async (ctx) => {
		const cards = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.collect();
		const out: { cardId: Id<'knowledgeCards'>; title: string; categories: string[] }[] = [];
		for (const c of cards) {
			let categories: string[] = [];
			const articleId = c.generation?.sourceArticleId;
			if (articleId !== undefined) {
				const article = await ctx.db.get(articleId);
				categories = article?.categories ?? [];
			}
			out.push({ cardId: c._id, title: c.source.articleTitle, categories });
		}
		return out;
	}
});

/**
 * Re-classify every published card for safety (W4) and suppress the unsafe ones.
 * Dry-run (report only) unless `apply: true`. Reversible (suppressed → published).
 *   bunx convex run safety:backfillSafety               # report
 *   bunx convex run safety:backfillSafety '{"apply":true}'
 */
export const backfillSafety = internalAction({
	args: { apply: v.optional(v.boolean()), nowYear: v.optional(v.number()) },
	returns: v.object({
		scanned: v.number(),
		unsafe: v.number(),
		suppressed: v.number(),
		reasons: v.array(v.object({ title: v.string(), reason: v.string() }))
	}),
	handler: async (ctx, { apply, nowYear }) => {
		const rows = await ctx.runQuery(internal.safety.listPublishedForSafety, {});
		const unsafeIds: Id<'knowledgeCards'>[] = [];
		const reasons: { title: string; reason: string }[] = [];
		for (const r of rows) {
			const verdict = classifySafety({ categories: r.categories, title: r.title, nowYear });
			if (!verdict.safe) {
				unsafeIds.push(r.cardId);
				reasons.push({ title: r.title, reason: verdict.reason ?? 'unknown' });
			}
		}
		let suppressed = 0;
		if (apply === true && unsafeIds.length > 0) {
			suppressed = (await ctx.runMutation(internal.curation.suppressCards, { ids: unsafeIds }))
				.suppressed;
		}
		return { scanned: rows.length, unsafe: unsafeIds.length, suppressed, reasons };
	}
});
```

Note: pass `nowYear` explicitly when running live (an action has no ambient clock) so the recency-gated rules fire, e.g. `'{"apply":true,"nowYear":2026}'`. The convex-test omits `nowYear` on purpose — the forced `'Suicide methods'` title trips the era-independent `harm` rule, so the test is deterministic without a clock.

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run test:convex -- safety`
Expected: PASS — the dry-run reports `unsafe >= 1` without mutating, and `apply: true` flips the forced-unsafe card to `suppressed`.

- [ ] **Step 5: Run the full suite**

Run: `bun run verify`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add convex/safety.ts convex/safety.test.ts
git commit -m "feat(safety): backfillSafety suppresses published unsafe cards (W4)"
```

---

### Task 4: Record the gate

**Files:**

- Modify: `docs/release-gates.md`

- [ ] **Step 1: Mark the safety should-fix addressed**

In `docs/release-gates.md`, update the "Safety guardrails are reactive only" 🟠 item: check it off, noting W4 added `classifySafety` at the ingest chokepoint (`decideArticleStatus`) + `backfillSafety` for published cards, with the targeted posture, and that rank-time is structural (published-only feed). Note the keyword lists are tunable against the `decisions` log and that the backfill should be run live (`bunx convex run safety:backfillSafety '{"apply":true,"nowYear":2026}'`) when deploys resume.

- [ ] **Step 2: Verify formatting**

Run: `bunx prettier --check docs/release-gates.md`
Expected: clean (run `bunx prettier --write docs/release-gates.md` twice first if needed — this file has needed a second pass before).

- [ ] **Step 3: Commit**

```bash
git add docs/release-gates.md
git commit -m "docs(release-gates): safety guardrails addressed (W4)"
```

---

## Self-Review

**Spec coverage** (against `2026-06-27-w4-safety-guardrails-design.md`):

- `classifySafety` pure classifier (harm/advice era-independent; politics/legal/tragedy recency-gated; uncertain→safe; never throws) → Task 1 ✓
- Folded into `decideArticleStatus` first (safety wins); both ingest sites inherit; `safety:` basis → Task 2 ✓
- `backfillSafety` (dry-run/apply, reversible, joins source categories, reuses `suppressCards`) → Task 3 ✓
- Rank-time structural (no feed change) → not a task, by design ✓
- No schema change → reuses `filtered_out`/`suppressed` ✓
- release-gates updated → Task 4 ✓
- Deferred items (LLM content check, admin UI, sensitive flag) → absent ✓

**Placeholder scan:** concrete classifier + tests + backfill code; the keyword arrays are real starters (the spec/Task notes flag them as tunable, which is a runtime-tuning note, not a code gap). ✓

**Type/name consistency:** `classifySafety({categories,title,nowYear})→{safe,reason}` and `SafetyReason` are identical across Task 1 (def), Task 2 (decideArticleStatus), Task 3 (backfill). `internal.curation.suppressCards({ids})→{suppressed}` matches `curation.ts`. The `by_status_shuffle` index name matches `feed.ts`/`cards.ts`/`curation.ts`. ✓
