# Offline-ETL Catalog Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Build the catalog from sampled Wikimedia hourly pageview dumps via a local script → staging table → drain-merge into `topics` (preserving cardCount/evergreen).

**Architecture:** Pure `parsePageviewLine` (shared by script + tests); a `topicsStaging` table loaded by `convex import`; `mergeStagingIntoCatalog` consumes staging in batches, upserting into `topics` by slug. The daily in-Convex cron stays.

**Tech Stack:** Node/bun script (zlib gunzip), Convex, Vitest + convex-test.

## Global Constraints

- Source: `https://dumps.wikimedia.org/other/pageviews/YYYY/YYYY-MM/pageviews-YYYYMMDD-HH0000.gz`, format `domain_code page_title count total_bytes`. Keep `domain_code === 'en'` (verify against a real sample line). Reuse `isRealArticleTitle`/`isQualityTopic`/`toSlug` from `convex/topicsLogic.ts`.
- **Never `--replace` the live `topics` table.** Merge upserts by slug; existing `cardCount`/`evergreen` are preserved (only `pageviews`/`updatedAt` change on a hit). New rows: `cardCount:0`, `source:'wikipedia-dump'`.
- Convex: `internal*` privacy, explicit `=== null`. After adding functions: `npx convex dev --once`. Tests: `bun run test:convex`. Before commit: `bun run check` + `bunx eslint <files>` (0).

---

### Task 1: `parsePageviewLine`

**Files:** Create `convex/dumpParse.ts`, `convex/dumpParse.test.ts`.

- [ ] **Step 1: failing test** — `convex/dumpParse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsePageviewLine } from './dumpParse';

describe('parsePageviewLine', () => {
	it('parses an en main-namespace article line', () => {
		expect(parsePageviewLine('en Cleopatra 540 0')).toEqual({ title: 'Cleopatra', views: 540 });
		expect(parsePageviewLine('en Marie_Curie 1200 0')).toEqual({
			title: 'Marie_Curie',
			views: 1200
		});
	});
	it('rejects other domains, junk titles, and malformed lines', () => {
		expect(parsePageviewLine('de Berlin 900 0')).toBeNull(); // not en
		expect(parsePageviewLine('en.m Cleopatra 5 0')).toBeNull(); // mobile domain
		expect(parsePageviewLine('en Main_Page 99999 0')).toBeNull(); // structural junk
		expect(parsePageviewLine('en .xyz 50 0')).toBeNull(); // quality junk
		expect(parsePageviewLine('en Special:Search 50 0')).toBeNull();
		expect(parsePageviewLine('garbage')).toBeNull();
		expect(parsePageviewLine('en Foo notanumber 0')).toBeNull();
	});
});
```

- [ ] **Step 2: run → fail.**

- [ ] **Step 3: implement** — `convex/dumpParse.ts`:

```ts
import { isRealArticleTitle, isQualityTopic } from './topicsLogic';

/**
 * Parse one Wikimedia hourly pageview dump line: `domain_code page_title count total_bytes`.
 * Keeps only `en` (en.wikipedia main namespace) articles passing the quality gates.
 * Returns the title as-is from the dump (underscored); null otherwise.
 */
export function parsePageviewLine(line: string): { title: string; views: number } | null {
	const parts = line.split(' ');
	if (parts.length < 3) return null;
	const [domain, title, countRaw] = parts;
	if (domain !== 'en' || title === undefined) return null;
	const views = Number(countRaw);
	if (!Number.isFinite(views) || views <= 0) return null;
	if (!isRealArticleTitle(title) || !isQualityTopic(title)) return null;
	return { title, views };
}
```

- [ ] **Step 4: test + checks** — `npx vitest run --project convex convex/dumpParse.test.ts` (PASS); `bun run check` (0); `bunx eslint convex/dumpParse.ts` (0).
- [ ] **Step 5: commit** — `git add convex/dumpParse.ts convex/dumpParse.test.ts && git commit -m "feat(catalog): parsePageviewLine for Wikimedia pageview dumps"`

---

### Task 2: `topicsStaging` table + `mergeStagingIntoCatalog`

**Files:** Modify `convex/schema.ts`, `convex/topics.ts`, `convex/topics.test.ts`.

**Interfaces:** `topicsStaging {title,slug,pageviews}`; `internal.topics.mergeStagingIntoCatalog({batch?})` → `{merged, done}` (drains staging in batches, upserting into `topics`, preserving cardCount/evergreen).

- [ ] **Step 1: failing test** — append `convex/topics.test.ts`:

```ts
test('mergeStagingIntoCatalog drains staging into topics, preserving cardCount/evergreen', async () => {
	const t = convexTest(schema, modules);
	// existing topic with state that MUST be preserved
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Cleopatra',
		pageviews: 100,
		source: 'wikipedia-top'
	});
	await t.mutation(internal.topics.setEvergreen, { slug: 'cleopatra', evergreen: true });
	await t.mutation(internal.topics.incrementCardCount, { slug: 'cleopatra' });
	// staging: one dup (cleopatra) + one new (hannibal)
	await t.run(async (ctx) => {
		await ctx.db.insert('topicsStaging', { title: 'Cleopatra', slug: 'cleopatra', pageviews: 500 });
		await ctx.db.insert('topicsStaging', { title: 'Hannibal', slug: 'hannibal', pageviews: 300 });
	});

	const res = await t.mutation(internal.topics.mergeStagingIntoCatalog, { batch: 500 });
	expect(res).toEqual({ merged: 2, done: true });

	const cleo = await t.query(api.topics.bySlug, { slug: 'cleopatra' });
	expect(cleo?.cardCount).toBe(1); // preserved
	expect(cleo?.evergreen).toBe(true); // preserved
	expect(cleo?.pageviews).toBe(600); // 100 + 500 accumulated
	const han = await t.query(api.topics.bySlug, { slug: 'hannibal' });
	expect(han?.cardCount).toBe(0); // new insert
	expect(han?.source).toBe('wikipedia-dump');
	// staging drained
	expect(await t.run(async (ctx) => (await ctx.db.query('topicsStaging').collect()).length)).toBe(
		0
	);
});
```

- [ ] **Step 2: run → fail.**

- [ ] **Step 3a: schema** — add to `convex/schema.ts` `defineSchema`:

```ts
	topicsStaging: defineTable({
		title: v.string(),
		slug: v.string(),
		pageviews: v.number()
	}),
```

- [ ] **Step 3b: `convex/topics.ts`** — add (`mergePageviews`/`toSlug` are imported from `./topicsLogic`; add them if not):

```ts
/**
 * Drain a batch of `topicsStaging` into `topics`, upserting by slug. Existing
 * topics keep their cardCount/evergreen (only pageviews accumulate); new slugs
 * insert with cardCount:0. Deletes each staging row as it's consumed, so repeated
 * calls drain the table (no cursor needed). `done` when a partial batch returns.
 */
export const mergeStagingIntoCatalog = internalMutation({
	args: { batch: v.optional(v.number()) },
	handler: async (ctx, { batch }): Promise<{ merged: number; done: boolean }> => {
		const size = batch ?? 500;
		const rows = await ctx.db.query('topicsStaging').take(size);
		const now = Date.now();
		for (const row of rows) {
			const existing = await ctx.db
				.query('topics')
				.withIndex('by_slug', (q) => q.eq('slug', row.slug))
				.unique();
			if (existing !== null) {
				await ctx.db.patch(existing._id, {
					pageviews: mergePageviews(existing.pageviews, row.pageviews),
					updatedAt: now
				});
			} else {
				await ctx.db.insert('topics', {
					title: row.title,
					slug: row.slug,
					pageviews: row.pageviews,
					cardCount: 0,
					source: 'wikipedia-dump',
					updatedAt: now
				});
			}
			await ctx.db.delete(row._id);
		}
		return { merged: rows.length, done: rows.length < size };
	}
});
```

- [ ] **Step 4: regenerate + tests + full suite + checks** — `npx convex dev --once`; `npx vitest run --project convex convex/topics.test.ts` (PASS); `bun run test:convex` (green); `bun run check` (0); `bunx eslint convex/topics.ts` (0).
- [ ] **Step 5: commit** — `git add convex/schema.ts convex/topics.ts convex/topics.test.ts convex/_generated && git commit -m "feat(catalog): topicsStaging + mergeStagingIntoCatalog (drain-upsert)"`

---

### Task 3: `scripts/build-catalog.mjs` (the ETL script)

**Files:** Create `scripts/build-catalog.mjs`, `scripts/README-catalog.md`.

This is an ops script (not deployed, not unit-tested — it imports the tested `parsePageviewLine`). It must `bun run check`-clean if picked up by tsconfig; if it isn't (it's `.mjs` outside `src`/`convex`), ensure it at least runs without error on `--help`.

- [ ] **Step 1: write the script** — `scripts/build-catalog.mjs`:

```js
#!/usr/bin/env bun
// Build a ranked topic catalog from sampled Wikimedia hourly pageview dumps.
// Usage: bun scripts/build-catalog.mjs [--top N] [--out file.jsonl] [--files urls.txt]
// Streams each .gz dump, parses en main-namespace articles, accumulates views,
// emits top-N JSONL {title, slug, pageviews}. Then:
//   npx convex import --replace --table topicsStaging <out>
//   (loop) npx convex run topics:mergeStagingIntoCatalog '{"batch":500}'  until {"done":true}
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { parsePageviewLine } from '../convex/dumpParse.js';
import { toSlug } from '../convex/topicsLogic.js';

// Default sample: one hour (12:00) on the 1st of each of the last ~18 months,
// spread across time to dilute recency. Edit/override via --files.
const DEFAULT_FILES = (() => {
	const urls = [];
	for (let i = 1; i <= 18; i++) {
		const d = new Date(Date.UTC(2026, 5 - i, 1, 12)); // walk back from 2026-05
		const y = d.getUTCFullYear();
		const m = String(d.getUTCMonth() + 1).padStart(2, '0');
		const day = String(d.getUTCDate()).padStart(2, '0');
		urls.push(
			`https://dumps.wikimedia.org/other/pageviews/${y}/${y}-${m}/pageviews-${y}${m}${day}-120000.gz`
		);
	}
	return urls;
})();

const arg = (flag, def) => {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : def;
};
const TOP = Number(arg('--top', '200000'));
const OUT = arg('--out', 'catalog.jsonl');

async function streamFile(url, counts) {
	const res = await fetch(url, {
		headers: { 'User-Agent': 'BrainRotPro/0.1 (leland.husband@gmail.com)' }
	});
	if (!res.ok) {
		console.error(`skip ${url}: ${res.status}`);
		return;
	}
	const rl = createInterface({
		input: (await import('node:stream')).Readable.fromWeb(res.body).pipe(createGunzip())
	});
	for await (const line of rl) {
		const p = parsePageviewLine(line);
		if (p) counts.set(p.title, (counts.get(p.title) ?? 0) + p.views);
	}
	console.error(`done ${url} (${counts.size} unique so far)`);
}

const files = process.argv.includes('--files')
	? (await import('node:fs')).readFileSync(arg('--files'), 'utf8').split('\n').filter(Boolean)
	: DEFAULT_FILES;
const counts = new Map();
for (const url of files) {
	try {
		await streamFile(url, counts);
	} catch (e) {
		console.error(`error ${url}: ${e.message}`);
	}
}

const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP);
const jsonl = top
	.map(([title, pageviews]) => JSON.stringify({ title, slug: toSlug(title), pageviews }))
	.join('\n');
writeFileSync(OUT, jsonl);
console.error(`wrote ${top.length} topics to ${OUT}`);
```

> The implementer must confirm two things by inspecting a real dump line (download one file's first KB): (1) the exact `domain_code` for en.wikipedia main (`en` per the modern pageviews format — adjust `parsePageviewLine` in Task 1's file ONLY if a real sample shows otherwise, and re-run its test), and (2) that `Readable.fromWeb(res.body).pipe(createGunzip())` streams correctly in bun (use an equivalent if not). Keep the title underscored (dump form); `toSlug` normalizes for the slug.

- [ ] **Step 2: README** — `scripts/README-catalog.md`: document the three-step flow (build → `npx convex import --replace --table topicsStaging catalog.jsonl` → loop `npx convex run topics:mergeStagingIntoCatalog '{"batch":500}'` until `done:true`), the sampling rationale, and how to widen coverage (`--files` with more URLs / `--top`).

- [ ] **Step 3: smoke** — `bun scripts/build-catalog.mjs --files /dev/stdin --top 5 <<< ''` (empty input → writes 0 topics, exits 0) to confirm it parses args + imports the shared modules without throwing. (Do NOT download the full default set in CI.) Run `bun run check` + `bunx eslint scripts/build-catalog.mjs` (fix any lint; if the script is outside the lint/tsconfig globs, note it).
- [ ] **Step 4: commit** — `git add scripts/build-catalog.mjs scripts/README-catalog.md && git commit -m "feat(catalog): offline ETL script (dump → staging JSONL)"`

---

## Post-implementation (controller)

Run the ETL on a small real sample (e.g. 2–3 recent dump files), `npx convex import --replace --table topicsStaging catalog.jsonl`, then loop `mergeStagingIntoCatalog` until `done`; confirm the catalog jumps in size, stays junk-free, and pre-existing topics keep their cardCount/evergreen. Then widen `--files` for full breadth.

## Coverage boundary

The live dump download/stream isn't unit-tested (ops); `parsePageviewLine` (the parsing logic) and `mergeStagingIntoCatalog` (the upsert/preserve logic) are. The post-deploy run validates the end-to-end pipeline.
