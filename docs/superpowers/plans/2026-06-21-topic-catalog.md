# Topic Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a searchable, pageview-ranked Convex catalog of ~100–200k Wikipedia topics, harvested in-Convex from the Wikimedia top-pageviews API and refreshed by a daily cron.

**Architecture:** A new `topics` table (deduped by normalized slug, ranked by cumulative pageviews, with a denormalized `cardCount`) plus a `catalogState` singleton for resumable backfill. Pure helpers live in `topicsLogic.ts`; all Convex functions in `topics.ts`; a daily harvest cron in the existing `crons.ts`. Harvest reuses the existing Wikimedia top-pageviews endpoint and descriptive User-Agent. No external tooling, no feed/generation/UI changes.

**Tech Stack:** Convex (queries/mutations/actions, search index, cron), TypeScript, Vitest + `convex-test`. Spec: `docs/superpowers/specs/2026-06-21-topic-catalog-design.md`.

## Global Constraints

- **In-Convex only.** No external scripts or bulk dumps. Harvest via the Wikimedia REST top-pageviews endpoint.
- **Reuse Wikimedia access pattern verbatim:** endpoint base `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia.org/all-access`; request header `User-Agent: BrainRotPro/0.1 (https://github.com/lelanhus/brain-rot-pro; leland.husband@gmail.com)` (Wikimedia policy, ADR-005).
- **Private functions use `internalQuery`/`internalMutation`/`internalAction`.** Only `search`, `topByPageviews`, `bySlug` are public `query`.
- **Lint conventions:** explicit `=== null` / `=== undefined` (no truthiness on objects/strings); do not spread possibly-`undefined` keys into `db.patch` (exactOptionalPropertyTypes) — use separate small mutations instead.
- **Scope boundary:** no changes to the feed, card generation, or UI. `cardCount` upkeep going forward is owned by a later sub-project; this plan only sets it via a one-time backfill.
- **`source.articleTitle`** is the `sourceValidator` field on `knowledgeCards` (`convex/schema.ts`).
- **Run convex tests with:** `bun run test:convex` (single file: `npx vitest run --project convex convex/<file>.test.ts`). Run `bun run check` before each commit.

---

### Task 1: Pure catalog logic

**Files:**

- Create: `convex/topicsLogic.ts`
- Test: `convex/topicsLogic.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `isRealArticleTitle(title: string): boolean`
  - `toSlug(title: string): string`
  - `mergePageviews(existing: number, incoming: number): number`

- [ ] **Step 1: Write the failing test**

Create `convex/topicsLogic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isRealArticleTitle, toSlug, mergePageviews } from './topicsLogic';

describe('isRealArticleTitle', () => {
	it('accepts real articles (underscored or spaced)', () => {
		expect(isRealArticleTitle('Marie_Curie')).toBe(true);
		expect(isRealArticleTitle('Black hole')).toBe(true);
	});

	it('rejects namespaces, chrome, lists, disambiguation, bare numbers, empty', () => {
		expect(isRealArticleTitle('Main_Page')).toBe(false);
		expect(isRealArticleTitle('Special:Search')).toBe(false);
		expect(isRealArticleTitle('Wikipedia:About')).toBe(false);
		expect(isRealArticleTitle('Category:Physics')).toBe(false);
		expect(isRealArticleTitle('List_of_largest_cities')).toBe(false);
		expect(isRealArticleTitle('Mercury_(disambiguation)')).toBe(false);
		expect(isRealArticleTitle('2008')).toBe(false);
		expect(isRealArticleTitle('   ')).toBe(false);
	});
});

describe('toSlug', () => {
	it('normalizes spacing, underscores, and case to one key', () => {
		expect(toSlug('Marie Curie')).toBe('marie_curie');
		expect(toSlug('Marie_Curie')).toBe('marie_curie');
		expect(toSlug('  Black   Hole  ')).toBe('black_hole');
	});
});

describe('mergePageviews', () => {
	it('sums cumulative views across days', () => {
		expect(mergePageviews(0, 500)).toBe(500);
		expect(mergePageviews(500, 300)).toBe(800);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project convex convex/topicsLogic.test.ts`
Expected: FAIL — cannot resolve `./topicsLogic`.

- [ ] **Step 3: Write the implementation**

Create `convex/topicsLogic.ts`:

```ts
// Pure helpers for the topic catalog — no Convex deps, unit-tested in isolation.

const SKIP_PREFIXES = [
	'Special:',
	'Wikipedia:',
	'Portal:',
	'Help:',
	'Template:',
	'Category:',
	'File:',
	'Talk:',
	'User:',
	'Draft:',
	'Module:',
	'MediaWiki:'
];
const SKIP_EXACT = new Set(['Main_Page', 'Main Page', '-']);

/**
 * True if a Wikipedia title is a real, catalog-worthy article (namespace 0,
 * not chrome, not a list/disambiguation/bare-number page). Fail-closed:
 * anything ambiguous is rejected to keep the catalog clean.
 */
export function isRealArticleTitle(title: string): boolean {
	const t = title.trim();
	if (t === '' || SKIP_EXACT.has(t)) return false;
	if (SKIP_PREFIXES.some((p) => t.startsWith(p))) return false;
	if (t.startsWith('List_of_') || t.startsWith('List of ')) return false;
	if (/\(disambiguation\)/i.test(t)) return false;
	if (/^\d{1,4}$/.test(t)) return false; // bare years / numbers
	return true;
}

/**
 * Normalize a title to a stable dedupe/link key. Wikipedia treats spaces and
 * underscores interchangeably and is case-insensitive on the first letter, so
 * we lowercase and collapse whitespace/underscores.
 */
export function toSlug(title: string): string {
	return title
		.trim()
		.replace(/\s+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '')
		.toLowerCase();
}

/**
 * Cumulative popularity across harvested days. Sustained presence in the daily
 * top-1000 is itself signal, so we sum rather than take the max.
 */
export function mergePageviews(existing: number, incoming: number): number {
	return existing + incoming;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project convex convex/topicsLogic.test.ts`
Expected: PASS (3 describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add convex/topicsLogic.ts convex/topicsLogic.test.ts
git commit -m "feat(topics): pure catalog logic (filter, slug, pageview merge)"
```

---

### Task 2: Schema + `upsertTopic`

**Files:**

- Modify: `convex/schema.ts` (add `topics` and `catalogState` tables)
- Create: `convex/topics.ts` (just `upsertTopic` in this task)
- Test: `convex/topics.test.ts`

**Interfaces:**

- Consumes: `toSlug`, `mergePageviews` from `topicsLogic.ts`.
- Produces:
  - Tables `topics` and `catalogState` (shapes below).
  - `internal.topics.upsertTopic({ title: string, pageviews: number, source: string })` → void; dedupes by slug, accumulates pageviews, sets `cardCount: 0` on insert.

- [ ] **Step 1: Write the failing test**

Create `convex/topics.test.ts`:

```ts
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('upsertTopic inserts new topics and accumulates pageviews on duplicate slug', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Marie Curie',
		pageviews: 500,
		source: 'wikipedia-top'
	});
	// Same article, underscored variant on another day → same slug, summed views.
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Marie_Curie',
		pageviews: 300,
		source: 'wikipedia-top'
	});

	const rows = await t.run(async (ctx) => ctx.db.query('topics').collect());
	expect(rows).toHaveLength(1);
	expect(rows[0].slug).toBe('marie_curie');
	expect(rows[0].pageviews).toBe(800);
	expect(rows[0].cardCount).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project convex convex/topics.test.ts`
Expected: FAIL — `internal.topics` / table `topics` does not exist.

- [ ] **Step 3a: Add tables to schema**

In `convex/schema.ts`, add these two table definitions inside the `defineSchema({ ... })` object (alongside the existing tables; place after `userProfiles` for locality):

```ts
	/**
	 * Topic catalog: one row per Wikipedia article seen in top-pageview data,
	 * deduped by slug. `pageviews` is cumulative popularity (ranking + generation
	 * priority); `cardCount` is denormalized so generation can cheaply find
	 * popular topics that still lack cards (0 = needs generation).
	 */
	topics: defineTable({
		title: v.string(),
		slug: v.string(),
		pageviews: v.number(),
		cardCount: v.number(),
		source: v.string(),
		updatedAt: v.number()
	})
		.index('by_slug', ['slug'])
		.index('by_pageviews', ['pageviews'])
		.index('by_cardCount_pageviews', ['cardCount', 'pageviews'])
		.searchIndex('search_title', { searchField: 'title' }),

	/**
	 * Singleton (`key: 'global'`) tracking catalog harvest progress so the
	 * bounded backfill action can resume across runs.
	 */
	catalogState: defineTable({
		key: v.string(),
		lastHarvestedDate: v.string(), // ISO 'YYYY-MM-DD' of latest day the daily cron harvested
		backfillCursorDate: v.optional(v.string()), // ISO date the historical backfill has reached
		updatedAt: v.number()
	}).index('by_key', ['key']),
```

(`defineTable`, `v` are already imported at the top of `schema.ts`.)

- [ ] **Step 3b: Create `convex/topics.ts` with `upsertTopic`**

Create `convex/topics.ts`:

```ts
import { internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { toSlug, mergePageviews } from './topicsLogic';

/** Insert a topic or accumulate pageviews onto the existing row with this slug. */
export const upsertTopic = internalMutation({
	args: { title: v.string(), pageviews: v.number(), source: v.string() },
	handler: async (ctx, { title, pageviews, source }) => {
		const slug = toSlug(title);
		const existing = await ctx.db
			.query('topics')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.unique();
		const now = Date.now();
		if (existing !== null) {
			await ctx.db.patch(existing._id, {
				pageviews: mergePageviews(existing.pageviews, pageviews),
				updatedAt: now
			});
		} else {
			await ctx.db.insert('topics', {
				title,
				slug,
				pageviews,
				cardCount: 0,
				source,
				updatedAt: now
			});
		}
	}
});
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run --project convex convex/topics.test.ts`
Expected: PASS (one row, slug `marie_curie`, pageviews 800, cardCount 0).
Run: `bun run check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/topics.ts convex/topics.test.ts
git commit -m "feat(topics): topics + catalogState schema and upsertTopic"
```

---

### Task 3: Read queries (`search`, `topByPageviews`, `needingCards`, `bySlug`)

**Files:**

- Modify: `convex/topics.ts`
- Test: `convex/topics.test.ts`

**Interfaces:**

- Consumes: `topics` table, `upsertTopic` (for test setup).
- Produces:
  - `api.topics.search({ query: string, limit?: number })` → `Doc<'topics'>[]`
  - `api.topics.topByPageviews({ limit?: number })` → `Doc<'topics'>[]` (pageviews desc)
  - `internal.topics.needingCards({ limit?: number })` → `Doc<'topics'>[]` (`cardCount === 0`, pageviews desc)
  - `api.topics.bySlug({ slug: string })` → `Doc<'topics'> | null`

- [ ] **Step 1: Write the failing test**

Append to `convex/topics.test.ts`:

```ts
test('read queries: search by title, top by pageviews, needingCards, bySlug', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Black hole',
		pageviews: 900,
		source: 'wikipedia-top'
	});
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Marie Curie',
		pageviews: 500,
		source: 'wikipedia-top'
	});
	// Give one topic cards so it is excluded from needingCards.
	await t.run(async (ctx) => {
		const bh = await ctx.db
			.query('topics')
			.withIndex('by_slug', (q) => q.eq('slug', 'black_hole'))
			.unique();
		if (bh !== null) await ctx.db.patch(bh._id, { cardCount: 2 });
	});

	const top = await t.query(api.topics.topByPageviews, { limit: 10 });
	expect(top.map((r) => r.slug)).toEqual(['black_hole', 'marie_curie']);

	const needing = await t.query(internal.topics.needingCards, { limit: 10 });
	expect(needing.map((r) => r.slug)).toEqual(['marie_curie']); // black_hole excluded (has cards)

	const found = await t.query(api.topics.search, { query: 'Marie', limit: 10 });
	expect(found.some((r) => r.slug === 'marie_curie')).toBe(true);

	const one = await t.query(api.topics.bySlug, { slug: 'black_hole' });
	expect(one?.title).toBe('Black hole');

	const none = await t.query(api.topics.search, { query: '   ', limit: 10 });
	expect(none).toEqual([]);
});
```

Add `api` to the import at the top of the file:

```ts
import { api, internal } from './_generated/api';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project convex convex/topics.test.ts`
Expected: FAIL — `api.topics.search` etc. are not functions.

- [ ] **Step 3: Add the read queries**

Append to `convex/topics.ts` (and widen the imports on line 1):

```ts
import { internalMutation, internalQuery, query } from './_generated/server';
```

```ts
/** Topics ordered by popularity — curation suggestions + generation priority. */
export const topByPageviews = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) =>
		await ctx.db
			.query('topics')
			.withIndex('by_pageviews')
			.order('desc')
			.take(limit ?? 50)
});

/** Full-text title search over the catalog. Empty query returns nothing. */
export const search = query({
	args: { query: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, { query: q, limit }) => {
		const trimmed = q.trim();
		if (trimmed === '') return [];
		return await ctx.db
			.query('topics')
			.withSearchIndex('search_title', (s) => s.search('title', trimmed))
			.take(limit ?? 20);
	}
});

/** Most-popular topics that have no cards yet — the generation priority queue. */
export const needingCards = internalQuery({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) =>
		await ctx.db
			.query('topics')
			.withIndex('by_cardCount_pageviews', (q) => q.eq('cardCount', 0))
			.order('desc')
			.take(limit ?? 20)
});

/** Single topic lookup by slug. */
export const bySlug = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) =>
		await ctx.db
			.query('topics')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.unique()
});
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run --project convex convex/topics.test.ts`
Expected: PASS (both tests).
Run: `bun run check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add convex/topics.ts convex/topics.test.ts
git commit -m "feat(topics): search, topByPageviews, needingCards, bySlug queries"
```

---

### Task 4: Harvest pipeline (`harvestTopDay`, `backfillCatalog`, catalog-state helpers)

**Files:**

- Modify: `convex/topics.ts`
- Test: `convex/topics.test.ts`

**Interfaces:**

- Consumes: `isRealArticleTitle` from `topicsLogic.ts`; `upsertTopic`; `topics`/`catalogState` tables.
- Produces:
  - `internal.topics.readCatalogState({})` → `Doc<'catalogState'> | null`
  - `internal.topics.setBackfillCursor({ date: string })` → void
  - `internal.topics.setLastHarvested({ date: string })` → void
  - `internal.topics.harvestTopDay({ date: string })` → `{ fetched: number, kept: number }`
  - `internal.topics.backfillCatalog({ days?: number })` → `{ harvested: number }`

- [ ] **Step 1: Write the failing test**

Append to `convex/topics.test.ts`. This stubs `fetch` so the harvest is deterministic and offline:

```ts
import { vi } from 'vitest';

test('harvestTopDay filters noise and upserts the rest', async () => {
	const t = convexTest(schema, modules);
	const payload = {
		items: [
			{
				articles: [
					{ article: 'Marie_Curie', views: 1000 },
					{ article: 'Main_Page', views: 99999 }, // dropped
					{ article: 'Special:Search', views: 5000 }, // dropped
					{ article: 'Black_hole', views: 800 }
				]
			}
		]
	};
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok: true, json: async () => payload }) as unknown as Response)
	);

	const res = await t.action(internal.topics.harvestTopDay, { date: '2026-06-01' });
	expect(res).toEqual({ fetched: 4, kept: 2 });

	const rows = await t.run(async (ctx) => ctx.db.query('topics').collect());
	expect(rows.map((r) => r.slug).sort()).toEqual(['black_hole', 'marie_curie']);

	vi.unstubAllGlobals();
});

test('backfillCatalog walks days backward and advances the cursor', async () => {
	const t = convexTest(schema, modules);
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				({
					ok: true,
					json: async () => ({ items: [{ articles: [{ article: 'Octopus', views: 100 }] }] })
				}) as unknown as Response
		)
	);
	// Seed the cursor so the walk is deterministic (no reliance on Date.now()).
	await t.mutation(internal.topics.setBackfillCursor, { date: '2026-06-10' });

	const res = await t.action(internal.topics.backfillCatalog, { days: 3 });
	expect(res.harvested).toBe(3);

	const state = await t.query(internal.topics.readCatalogState, {});
	// Started one day before the seeded cursor (06-09) and walked back 3 days → 06-07.
	expect(state?.backfillCursorDate).toBe('2026-06-07');

	vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project convex convex/topics.test.ts`
Expected: FAIL — `harvestTopDay` / `backfillCatalog` / `readCatalogState` / `setBackfillCursor` not defined.

- [ ] **Step 3: Add the harvest pipeline**

Widen the imports on line 1 of `convex/topics.ts`:

```ts
import {
	action,
	internalAction,
	internalMutation,
	internalQuery,
	query
} from './_generated/server';
```

Add the `internal` API import near the top:

```ts
import { internal } from './_generated/api';
import { isRealArticleTitle } from './topicsLogic';
```

Append the pipeline:

```ts
// Wikimedia top-pageviews endpoint + descriptive UA (Wikimedia policy, ADR-005).
const PAGEVIEWS_TOP =
	'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia.org/all-access';
const USER_AGENT =
	'BrainRotPro/0.1 (https://github.com/lelanhus/brain-rot-pro; leland.husband@gmail.com)';

const DAY_MS = 86_400_000;

/** ISO 'YYYY-MM-DD' (UTC) for a millisecond timestamp. */
function isoDate(ms: number): string {
	const dt = new Date(ms);
	const y = dt.getUTCFullYear();
	const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
	const d = String(dt.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

export const readCatalogState = internalQuery({
	args: {},
	handler: async (ctx) =>
		await ctx.db
			.query('catalogState')
			.withIndex('by_key', (q) => q.eq('key', 'global'))
			.unique()
});

export const setBackfillCursor = internalMutation({
	args: { date: v.string() },
	handler: async (ctx, { date }) => {
		const row = await ctx.db
			.query('catalogState')
			.withIndex('by_key', (q) => q.eq('key', 'global'))
			.unique();
		const now = Date.now();
		if (row !== null) await ctx.db.patch(row._id, { backfillCursorDate: date, updatedAt: now });
		else
			await ctx.db.insert('catalogState', {
				key: 'global',
				lastHarvestedDate: '',
				backfillCursorDate: date,
				updatedAt: now
			});
	}
});

export const setLastHarvested = internalMutation({
	args: { date: v.string() },
	handler: async (ctx, { date }) => {
		const row = await ctx.db
			.query('catalogState')
			.withIndex('by_key', (q) => q.eq('key', 'global'))
			.unique();
		const now = Date.now();
		if (row !== null) await ctx.db.patch(row._id, { lastHarvestedDate: date, updatedAt: now });
		else
			await ctx.db.insert('catalogState', {
				key: 'global',
				lastHarvestedDate: date,
				updatedAt: now
			});
	}
});

/** Fetch one day's top-1000, filter noise, upsert survivors. Throws on API error. */
export const harvestTopDay = internalAction({
	args: { date: v.string() }, // 'YYYY-MM-DD'
	handler: async (ctx, { date }): Promise<{ fetched: number; kept: number }> => {
		const [y, m, d] = date.split('-');
		const res = await fetch(`${PAGEVIEWS_TOP}/${y}/${m}/${d}`, {
			headers: { 'User-Agent': USER_AGENT }
		});
		if (!res.ok) throw new Error(`Pageviews API ${res.status} for ${date}`);
		const data = (await res.json()) as {
			items?: { articles?: { article: string; views: number }[] }[];
		};
		const articles = data.items?.[0]?.articles ?? [];
		let kept = 0;
		for (const a of articles) {
			if (!isRealArticleTitle(a.article)) continue;
			await ctx.runMutation(internal.topics.upsertTopic, {
				title: a.article,
				pageviews: a.views,
				source: 'wikipedia-top'
			});
			kept++;
		}
		return { fetched: articles.length, kept };
	}
});

/**
 * Bounded, resumable historical backfill. Walks backward `days` days from the
 * day before the stored cursor (or 2 days ago if none — pageview data lags
 * ~1–2 days), harvesting each and advancing the cursor only after a day
 * succeeds. On API failure `harvestTopDay` throws, the run stops, and the
 * cursor is preserved at the last success so the next run retries that day.
 */
export const backfillCatalog = internalAction({
	args: { days: v.optional(v.number()) },
	handler: async (ctx, { days }): Promise<{ harvested: number }> => {
		const state = await ctx.runQuery(internal.topics.readCatalogState, {});
		const startMs =
			state?.backfillCursorDate !== undefined && state.backfillCursorDate !== ''
				? Date.parse(`${state.backfillCursorDate}T00:00:00Z`) - DAY_MS
				: Date.now() - 2 * DAY_MS;
		const n = days ?? 30;
		let cursorMs = startMs;
		let harvested = 0;
		for (let i = 0; i < n; i++) {
			const date = isoDate(cursorMs);
			await ctx.runAction(internal.topics.harvestTopDay, { date });
			await ctx.runMutation(internal.topics.setBackfillCursor, { date });
			harvested++;
			cursorMs -= DAY_MS;
		}
		return { harvested };
	}
});
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run --project convex convex/topics.test.ts`
Expected: PASS — `harvestTopDay` returns `{ fetched: 4, kept: 2 }`; `backfillCatalog` harvests 3 days and leaves cursor `2026-06-07`.
Run: `bun run check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add convex/topics.ts convex/topics.test.ts
git commit -m "feat(topics): in-Convex harvest pipeline (harvestTopDay + resumable backfill)"
```

---

### Task 5: Daily cron + one-time card-count backfill

**Files:**

- Modify: `convex/topics.ts` (add `harvestRecent`, `backfillCardCounts`)
- Modify: `convex/crons.ts` (register daily harvest)
- Test: `convex/topics.test.ts`

**Interfaces:**

- Consumes: `harvestTopDay`, `setLastHarvested`, `toSlug`, `topics`/`knowledgeCards` tables.
- Produces:
  - `internal.topics.harvestRecent({})` → void (cron entrypoint: harvest 2 days ago, record `lastHarvestedDate`)
  - `internal.topics.backfillCardCounts({})` → `{ updated: number }` (one-time: set `cardCount` from existing published cards)

- [ ] **Step 1: Write the failing test**

Append to `convex/topics.test.ts`:

```ts
test('backfillCardCounts sets cardCount from published cards, skipping uncatalogued sources', async () => {
	const t = convexTest(schema, modules);
	// Catalog has Marie Curie; "Obscurity" is NOT catalogued.
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Marie Curie',
		pageviews: 500,
		source: 'wikipedia-top'
	});
	// Two published cards sourced from Marie Curie, one from an uncatalogued article.
	await t.run(async (ctx) => {
		// All required knowledgeCards fields (see schema.ts): hook, body, format,
		// conceptTags, source, status, shuffleKey, createdAt. Optional fields omitted.
		const base = {
			hook: 'h',
			body: 'b',
			format: 'surprise_fact' as const,
			conceptTags: ['science'],
			status: 'published' as const,
			shuffleKey: 0.5,
			createdAt: 1
		};
		const src = (articleTitle: string) => ({
			articleTitle,
			articleUrl: `https://en.wikipedia.org/wiki/${articleTitle}`,
			revisionId: null,
			sourceSpan: 's'
		});
		await ctx.db.insert('knowledgeCards', { ...base, source: src('Marie Curie') });
		await ctx.db.insert('knowledgeCards', { ...base, source: src('Marie_Curie') });
		await ctx.db.insert('knowledgeCards', { ...base, source: src('Obscurity') });
	});

	const res = await t.action(internal.topics.backfillCardCounts, {});
	expect(res.updated).toBe(1); // only Marie Curie matched the catalog

	const topic = await t.query(api.topics.bySlug, { slug: 'marie_curie' });
	expect(topic?.cardCount).toBe(2);
});
```

> The `base` object above includes exactly the required `knowledgeCards` fields and a valid `format` literal, so the inserts pass as written. The card shape is not owned by this plan — if the schema later changes, match it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project convex convex/topics.test.ts`
Expected: FAIL — `backfillCardCounts` not defined.

- [ ] **Step 3a: Add `harvestRecent` and `backfillCardCounts` to `convex/topics.ts`**

Add `toSlug` to the `topicsLogic` import:

```ts
import { isRealArticleTitle, toSlug } from './topicsLogic';
```

Append:

```ts
/** Cron entrypoint: harvest the most recently available day (data lags ~2 days). */
export const harvestRecent = internalAction({
	args: {},
	handler: async (ctx): Promise<void> => {
		const date = isoDate(Date.now() - 2 * DAY_MS);
		await ctx.runAction(internal.topics.harvestTopDay, { date });
		await ctx.runMutation(internal.topics.setLastHarvested, { date });
	}
});

/**
 * One-time: seed `cardCount` from existing published cards by mapping each
 * card's source article title to a topic slug. Cards whose source isn't in the
 * catalog are skipped. Going forward, `cardCount` upkeep is owned by the
 * generation sub-project — this only backfills history.
 */
export const backfillCardCounts = internalMutation({
	args: {},
	handler: async (ctx): Promise<{ updated: number }> => {
		const cards = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.collect();
		const counts = new Map<string, number>();
		for (const c of cards) {
			const slug = toSlug(c.source.articleTitle);
			counts.set(slug, (counts.get(slug) ?? 0) + 1);
		}
		let updated = 0;
		const now = Date.now();
		for (const [slug, count] of counts) {
			const topic = await ctx.db
				.query('topics')
				.withIndex('by_slug', (q) => q.eq('slug', slug))
				.unique();
			if (topic !== null) {
				await ctx.db.patch(topic._id, { cardCount: count, updatedAt: now });
				updated++;
			}
		}
		return { updated };
	}
});
```

> `backfillCardCounts` is an `internalMutation` (pure DB work, runs in one transaction; the card volume is small). The test calls it via `t.action(...)` — convex-test resolves both via the same reference, but to match runtime exactly invoke it with `t.mutation(internal.topics.backfillCardCounts, {})` in the test. Update the test's call accordingly if the action form errors.

- [ ] **Step 3b: Register the daily cron**

In `convex/crons.ts`, add a daily harvest job. Final file:

```ts
import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
import { SUPPLY_BATCH } from './generationPipeline';

// Once an hour, turn the top in-demand concepts into auto-published cards
// so the shared library stays ahead of consumption. Bounded by the Workpool's
// concurrency + per-run caps so it can never run away on cost.
const crons = cronJobs();

crons.interval(
	'generate from demand',
	{ hours: 1 },
	internal.generationPipeline.processDemand,
	SUPPLY_BATCH
);

// Daily: append the most recently available day's top-pageview topics to the
// catalog so it keeps growing without manual backfill runs.
crons.interval('harvest top pageviews', { hours: 24 }, internal.topics.harvestRecent, {});

export default crons;
```

- [ ] **Step 4: Run test + full convex suite + typecheck**

Run: `npx vitest run --project convex convex/topics.test.ts`
Expected: PASS — `backfillCardCounts` returns `{ updated: 1 }`, Marie Curie `cardCount` is 2.
Run: `bun run test:convex`
Expected: entire convex suite green (no regressions).
Run: `bun run check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add convex/topics.ts convex/crons.ts convex/topics.test.ts
git commit -m "feat(topics): daily harvest cron + one-time cardCount backfill"
```

---

## Post-implementation (manual, after all tasks merge)

These are operational steps, not code tasks — run them once the code is deployed:

1. Deploy backend: `npx convex dev --once` (per the project's dev-deployment workflow).
2. Seed the catalog from existing cards: `npx convex run topics:backfillCardCounts` (note: internal — use the dashboard "Run function" or a deploy key; or temporarily expose if needed).
3. Kick off the historical backfill in bounded passes: `npx convex run topics:backfillCatalog '{"days":30}'` repeatedly (or schedule), watching row growth via `topics:topByPageviews`. The daily cron keeps it current thereafter.

(Internal functions aren't CLI-runnable without a deploy key; if you want these runnable from the CLI during ops, add thin public `action` wrappers in a follow-up — deliberately omitted here to keep the catalog's write surface internal.)

## Notes on verification

- The catalog is independently verifiable: after backfill, `topics:topByPageviews` returns popular titles, `topics:search` finds them, `topics:needingCards` lists uncarded topics popularity-first, and re-running a harvested day doesn't create duplicate rows (only re-accumulates pageviews).
- This plan changes no feed, generation, or UI behavior — the only runtime addition is one daily cron.
