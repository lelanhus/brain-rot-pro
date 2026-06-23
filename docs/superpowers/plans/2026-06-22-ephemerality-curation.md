# Ephemerality-Aware Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop ephemeral current-events topics from being turned into cards, and reversibly retire the ones already published, by adding a recency dimension to the existing Wikidata classifier.

**Architecture:** A pure `isEphemeral` helper (Wikidata temporal claims + a title year-token) folds into `decideArticleStatus` ahead of the allowlist, so ephemeral ⇒ `filtered_out` ⇒ the existing `evergreen: false` flag ⇒ never generated and excluded from cold-start order. A small `convex/curation.ts` re-classifies already-published cards and flips ephemeral ones to the existing reversible `suppressed` status (dry-run by default).

**Tech Stack:** Convex (actions / internalActions / internalMutations / queries), TypeScript, Vitest + convex-test (fetch stubbed via `vi.stubGlobal`).

## Global Constraints

- **No editorial topic blocklists** — this is supply + freshness only; per-user taste stays with personalization.
- **No `Date` in pure logic** (ADR-007). `nowYear` is computed in the action/handler layer (`new Date().getUTCFullYear()`) and passed into pure functions.
- **Recency window = 2 years** — `EPHEMERAL_WINDOW_YEARS = 2` (blocks `[nowYear-2, nowYear]`, i.e. 2024–2026 when nowYear=2026). Keeps WWI (1914), Chernobyl (1986), Dreadnought (1906).
- **Fail-open on absence** — missing/failed Wikidata temporal data must never block; the title fast-path still applies.
- **Reversible retire** — reuse the existing `suppressed` card status (feed serves only `published`); never delete.
- **bun** is the package runner; verify with `bun run verify` (offline gate).
- Branch before starting (we are on `main`): `git checkout -b feat/ephemerality-curation`.

---

### Task 1: Pure ephemerality logic in `wikidataLogic.ts`

**Files:**

- Modify: `convex/wikidataLogic.ts` (add `EPHEMERAL_WINDOW_YEARS`, `isEphemeral`; extend `decideArticleStatus`)
- Test: `convex/wikidataLogic.test.ts`

**Interfaces:**

- Consumes: existing `TopicVerdict`, `decideArticleStatus` from this file.
- Produces:
  - `EPHEMERAL_WINDOW_YEARS: number` (= 2)
  - `isEphemeral(args: { temporalYears: number[]; title: string }, nowYear: number, windowYears?: number): { ephemeral: boolean; reason: string }`
  - `decideArticleStatus(args: { verdict: TopicVerdict | null; categories: string[]; title?: string; temporalYears?: number[]; nowYear?: number; windowYears?: number }): { status: ArticleStatus; basis: string }` — when `nowYear` is provided, the ephemeral check runs first and a positive result returns `{ status: 'filtered_out', basis: 'ephemeral: <reason>' }`. When `nowYear` is omitted, behavior is unchanged from today.

- [ ] **Step 1: Write the failing tests** — append to `convex/wikidataLogic.test.ts`:

```ts
import {
	classifyTopic,
	decideArticleStatus,
	isEphemeral,
	EPHEMERAL_WINDOW_YEARS,
	HUMAN
} from './wikidataLogic';

describe('isEphemeral', () => {
	const now = 2026;
	it('flags a temporal anchor inside the window', () => {
		expect(isEphemeral({ temporalYears: [2026], title: 'X' }, now).ephemeral).toBe(true);
		expect(isEphemeral({ temporalYears: [2024], title: 'X' }, now).ephemeral).toBe(true); // window=2
	});
	it('keeps old temporal anchors (WWI, Chernobyl, Dreadnought)', () => {
		expect(isEphemeral({ temporalYears: [1914], title: 'World War I' }, now).ephemeral).toBe(false);
		expect(isEphemeral({ temporalYears: [1986], title: 'Chernobyl disaster' }, now).ephemeral).toBe(
			false
		);
		expect(isEphemeral({ temporalYears: [1906], title: 'Dreadnought' }, now).ephemeral).toBe(false);
	});
	it('flags a recent-year token in the title (no temporal data needed)', () => {
		expect(
			isEphemeral({ temporalYears: [], title: 'List of attacks during the 2026 Iran war' }, now)
				.ephemeral
		).toBe(true);
		expect(isEphemeral({ temporalYears: [], title: '2026 Iran war' }, now).ephemeral).toBe(true);
	});
	it('does not flag evergreen topics with no recent signal', () => {
		expect(isEphemeral({ temporalYears: [], title: 'Wombat' }, now).ephemeral).toBe(false);
		expect(
			isEphemeral({ temporalYears: [], title: 'List of chemical elements' }, now).ephemeral
		).toBe(false);
	});
	it('uses EPHEMERAL_WINDOW_YEARS = 2', () => {
		expect(EPHEMERAL_WINDOW_YEARS).toBe(2);
	});
});

describe('decideArticleStatus recency', () => {
	it('ephemeral beats an allowlist allow', () => {
		const verdict = classifyTopic({ instanceOf: ['Q198'] }); // war → allow
		expect(verdict.verdict).toBe('allow');
		const r = decideArticleStatus({
			verdict,
			categories: [],
			title: '2026 Iran war',
			temporalYears: [2026],
			nowYear: 2026
		});
		expect(r.status).toBe('filtered_out');
		expect(r.basis.startsWith('ephemeral')).toBe(true);
	});
	it('is unchanged when nowYear is omitted (back-compat)', () => {
		const verdict = classifyTopic({ instanceOf: ['Q198'] });
		expect(decideArticleStatus({ verdict, categories: [] }).status).toBe('fetched');
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test:convex -- wikidataLogic`
Expected: FAIL — `isEphemeral`/`EPHEMERAL_WINDOW_YEARS` not exported; the recency `decideArticleStatus` test fails.

- [ ] **Step 3: Implement in `convex/wikidataLogic.ts`** — add near the top (after the imports):

```ts
/** Recency window: a topic is ephemeral if anchored within the last N years. */
export const EPHEMERAL_WINDOW_YEARS = 2;

/**
 * Recency gate orthogonal to topic *type*: a topic is ephemeral when a Wikidata
 * temporal anchor (point in time / start time / inception) — or a 4-digit year
 * token in its title — falls inside [nowYear - windowYears, nowYear]. `nowYear`
 * is injected (no Date in pure logic, ADR-007). Fail-open: empty temporalYears
 * and a yearless title → not ephemeral.
 */
export function isEphemeral(
	args: { temporalYears: number[]; title: string },
	nowYear: number,
	windowYears: number = EPHEMERAL_WINDOW_YEARS
): { ephemeral: boolean; reason: string } {
	const minYear = nowYear - windowYears;
	const inWindow = (y: number) => Number.isFinite(y) && y >= minYear && y <= nowYear;
	for (const y of args.temporalYears) {
		if (inWindow(y)) return { ephemeral: true, reason: `recent: ${y}` };
	}
	for (const tok of args.title.match(/\b\d{4}\b/g) ?? []) {
		const y = Number(tok);
		if (inWindow(y)) return { ephemeral: true, reason: `title-year: ${y}` };
	}
	return { ephemeral: false, reason: '' };
}
```

Then change `decideArticleStatus` to accept the recency fields and check them first:

```ts
export function decideArticleStatus(args: {
	verdict: TopicVerdict | null;
	categories: string[];
	title?: string;
	temporalYears?: number[];
	nowYear?: number;
	windowYears?: number;
}): { status: ArticleStatus; basis: string } {
	if (args.nowYear !== undefined) {
		const eph = isEphemeral(
			{ temporalYears: args.temporalYears ?? [], title: args.title ?? '' },
			args.nowYear,
			args.windowYears
		);
		if (eph.ephemeral) return { status: 'filtered_out', basis: `ephemeral: ${eph.reason}` };
	}
	const v = args.verdict;
	if (v?.verdict === 'allow') return { status: 'fetched', basis: `wikidata: ${v.reason}` };
	if (v?.verdict === 'block') return { status: 'filtered_out', basis: `wikidata: ${v.reason}` };
	const evergreen = isEvergreenArticle(args.categories);
	return {
		status: evergreen ? 'fetched' : 'filtered_out',
		basis: `heuristic: ${evergreen ? 'evergreen' : 'excluded'}`
	};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test:convex -- wikidataLogic`
Expected: PASS (new + existing `decideArticleStatus`/`classifyTopic` tests all green).

- [ ] **Step 5: Commit**

```bash
git add convex/wikidataLogic.ts convex/wikidataLogic.test.ts
git commit -m "feat(curation): pure ephemerality gate (recency beats allowlist)"
```

---

### Task 2: Parse temporal claims and thread recency through ingest

**Files:**

- Modify: `convex/ingest.ts` (`fetchWikidataClaims` → add `temporalYears`; `classifyTitle` → return `ephemeral` + pass recency; `ingestTitles` + `ingestOne` → pass recency to `decideArticleStatus`)
- Test: `convex/ingest.test.ts`

**Interfaces:**

- Consumes: `isEphemeral`/`decideArticleStatus` (Task 1).
- Produces:
  - `fetchWikidataClaims(qid)` now resolves `(TopicClaims & { image?: string; temporalYears: number[] }) | null`.
  - `classifyTitle` internalAction now returns `{ evergreen: boolean; ephemeral: boolean } | null`. (`topics.classifyTopTopics` reads only `.evergreen` — unaffected. `curation` reads `.ephemeral` — Task 3.)

- [ ] **Step 1: Write the failing test** — add to `convex/ingest.test.ts` (mirror the existing two-URL `vi.stubGlobal('fetch', vi.fn(async (url) => …))` pattern). This stubs the Action API (categories + `wikibase_item` QID) and the Wikidata API (a P585 time claim in the window):

```ts
test('classifyTitle marks a recent-event topic ephemeral (and not evergreen)', async () => {
	const t = convexTest(schema, modules);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (url.includes('wikidata.org')) {
				return {
					ok: true,
					json: async () => ({
						entities: {
							Q1: {
								claims: {
									P31: [{ mainsnak: { datavalue: { value: { id: 'Q198' } } } }], // war → allow
									P585: [{ mainsnak: { datavalue: { value: { time: '+2026-06-01T00:00:00Z' } } } }]
								}
							}
						}
					})
				} as unknown as Response;
			}
			return {
				ok: true,
				json: async () => ({
					query: {
						pages: [
							{
								pageid: 1,
								title: '2026 Iran war',
								categories: [],
								pageprops: { wikibase_item: 'Q1' }
							}
						]
					}
				})
			} as unknown as Response;
		})
	);

	const res = await t.action(internal.ingest.classifyTitle, { title: '2026 Iran war' });
	expect(res).toEqual({ evergreen: false, ephemeral: true });

	vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:convex -- ingest`
Expected: FAIL — `classifyTitle` currently returns `{ evergreen: true }` (war is allowlisted; no recency check) and has no `ephemeral` field.

- [ ] **Step 3: Implement the changes in `convex/ingest.ts`**

(3a) In `fetchWikidataClaims`, add a year extractor and include `temporalYears` in the return. Insert before the `return` and update the return object:

```ts
const years = (prop: string): number[] =>
	(claims[prop] ?? [])
		.map((c) => c.mainsnak?.datavalue?.value)
		.map((val) =>
			val && typeof val === 'object' && 'time' in val ? (val as { time?: string }).time : undefined
		)
		.map((time) => (typeof time === 'string' ? Number(time.replace(/^[+-]/, '').slice(0, 4)) : NaN))
		.filter((y) => Number.isFinite(y));
const temporalYears = [...years('P585'), ...years('P580'), ...years('P571')];
return {
	instanceOf: ids('P31'),
	subclassOf: ids('P279'),
	occupations: ids('P106'),
	image,
	temporalYears
};
```

Also widen the function's return type annotation:

```ts
async function fetchWikidataClaims(
	qid: string
): Promise<(TopicClaims & { image?: string; temporalYears: number[] }) | null> {
```

(3b) In `classifyTitle`, compute recency and return `ephemeral`. Replace the two lines that build `verdict` and call `decideArticleStatus`/return with:

```ts
const verdict = claims !== null ? classifyTopic(claims) : null;
const nowYear = new Date().getUTCFullYear();
const { status, basis } = decideArticleStatus({
	verdict,
	categories,
	title,
	temporalYears: claims?.temporalYears ?? [],
	nowYear
});
return { evergreen: status === 'fetched', ephemeral: basis.startsWith('ephemeral') };
```

And update its return-type annotation:

```ts
		handler: async (_ctx, { title }): Promise<{ evergreen: boolean; ephemeral: boolean } | null> => {
```

(3c) In `ingestTitles`, pass recency to `decideArticleStatus`. Replace the `const { status, basis } = decideArticleStatus({ verdict, categories });` line with:

```ts
const { status, basis } = decideArticleStatus({
	verdict,
	categories,
	title: page.title,
	temporalYears: claims?.temporalYears ?? [],
	nowYear: new Date().getUTCFullYear()
});
```

(3d) In `ingestOne`, replace `const { status } = decideArticleStatus({ verdict, categories });` with:

```ts
const { status } = decideArticleStatus({
	verdict,
	categories,
	title: page.title,
	temporalYears: claims?.temporalYears ?? [],
	nowYear: new Date().getUTCFullYear()
});
```

- [ ] **Step 4: Run the test (and the existing ingest/topics suites) to verify they pass**

Run: `bun run test:convex -- ingest topics`
Expected: PASS — new ephemeral test green; existing ingest + `classifyTopTopics` tests unaffected (they read `.evergreen`).

- [ ] **Step 5: Commit**

```bash
git add convex/ingest.ts convex/ingest.test.ts
git commit -m "feat(curation): parse Wikidata temporal claims; thread recency into ingest gate"
```

---

### Task 3: Reversible retire pass for already-published cards (`convex/curation.ts`)

**Files:**

- Create: `convex/curation.ts`
- Test: `convex/curation.test.ts`

**Interfaces:**

- Consumes: `internal.ingest.classifyTitle` (returns `{ evergreen, ephemeral } | null`, Task 2); the `knowledgeCards` table (`status`, `source.articleTitle`); the existing `suppressed` card status.
- Produces:
  - `listPublishedSources` internalQuery — `{}` → `Array<{ cardId: Id<'knowledgeCards'>; title: string }>` for every `published` card.
  - `suppressCards` internalMutation — `{ ids: Id<'knowledgeCards'>[] }` → patches each to `status: 'suppressed'`; returns `{ suppressed: number }`.
  - `auditEphemeralPublished` action (public dev tooling, like `ingest.ingestTitles`) — `{ apply?: boolean }` → `{ scanned: number; distinctTopics: number; wouldSuppress: number; applied: number; samples: Array<{ title: string; count: number }> }`. Dry-run unless `apply === true`.

- [ ] **Step 1: Write the failing tests** — create `convex/curation.test.ts`:

```ts
import { convexTest } from 'convex-test';
import { describe, expect, test, vi } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';
import { modules } from './test.setup';

const baseCard = {
	hook: 'h',
	body: 'b',
	format: 'fact' as const,
	conceptTags: ['t'],
	source: { articleTitle: 'X', url: 'u', revisionId: null, paragraphs: ['p'] },
	shuffleKey: 0.5,
	createdAt: 0
};

describe('curation suppress/list', () => {
	test('listPublishedSources + suppressCards round-trip', async () => {
		const t = convexTest(schema, modules);
		const id = await t.run(async (ctx) =>
			ctx.db.insert('knowledgeCards', {
				...baseCard,
				source: { ...baseCard.source, articleTitle: 'Wombat' },
				status: 'published'
			})
		);
		const listed = await t.query(internal.curation.listPublishedSources, {});
		expect(listed).toEqual([{ cardId: id, title: 'Wombat' }]);

		const res = await t.mutation(internal.curation.suppressCards, { ids: [id] });
		expect(res).toEqual({ suppressed: 1 });
		const after = await t.run(async (ctx) => ctx.db.get(id));
		expect(after?.status).toBe('suppressed');
	});
});

describe('auditEphemeralPublished', () => {
	function stubClassify(ephemeralTitle: string) {
		// classifyTitle hits Action API then (if qid) Wikidata API. Return a recent
		// temporal claim only for the ephemeral title; an old one otherwise.
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: unknown) => {
				const body = String((init as { body?: string } | undefined)?.body ?? url);
				const isEphemeral =
					body.includes(encodeURIComponent(ephemeralTitle)) ||
					url.includes(encodeURIComponent(ephemeralTitle));
				if (url.includes('wikidata.org')) {
					return {
						ok: true,
						json: async () => ({
							entities: {
								Q1: {
									claims: {
										P31: [{ mainsnak: { datavalue: { value: { id: 'Q198' } } } }],
										P585: [
											{
												mainsnak: {
													datavalue: {
														value: {
															time: isEphemeral ? '+2026-01-01T00:00:00Z' : '+1986-01-01T00:00:00Z'
														}
													}
												}
											}
										]
									}
								}
							}
						})
					} as unknown as Response;
				}
				const title = isEphemeral ? ephemeralTitle : 'Chernobyl disaster';
				return {
					ok: true,
					json: async () => ({
						query: {
							pages: [{ pageid: 1, title, categories: [], pageprops: { wikibase_item: 'Q1' } }]
						}
					})
				} as unknown as Response;
			})
		);
	}

	test('dry-run reports ephemeral cards without mutating; apply suppresses only those', async () => {
		const t = convexTest(schema, modules);
		const ephId = await t.run(async (ctx) =>
			ctx.db.insert('knowledgeCards', {
				...baseCard,
				source: { ...baseCard.source, articleTitle: '2026 Iran war' },
				status: 'published'
			})
		);
		const keepId = await t.run(async (ctx) =>
			ctx.db.insert('knowledgeCards', {
				...baseCard,
				source: { ...baseCard.source, articleTitle: 'Chernobyl disaster' },
				status: 'published'
			})
		);

		stubClassify('2026 Iran war');

		const dry = await t.action(api.curation.auditEphemeralPublished, {});
		expect(dry.wouldSuppress).toBe(1);
		expect(dry.applied).toBe(0);
		expect((await t.run((ctx) => ctx.db.get(ephId)))?.status).toBe('published');

		const applied = await t.action(api.curation.auditEphemeralPublished, { apply: true });
		expect(applied.applied).toBe(1);
		expect((await t.run((ctx) => ctx.db.get(ephId)))?.status).toBe('suppressed');
		expect((await t.run((ctx) => ctx.db.get(keepId)))?.status).toBe('published');

		vi.unstubAllGlobals();
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test:convex -- curation`
Expected: FAIL — `convex/curation.ts` does not exist.

- [ ] **Step 3: Implement `convex/curation.ts`**

```ts
import { v } from 'convex/values';
import { action, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

/** Every published card with its source article title (for re-classification). */
export const listPublishedSources = internalQuery({
	args: {},
	handler: async (ctx) => {
		const cards = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.collect();
		return cards.map((c) => ({ cardId: c._id, title: c.source.articleTitle }));
	}
});

/** Flip the given cards to the reversible `suppressed` status (out of the feed). */
export const suppressCards = internalMutation({
	args: { ids: v.array(v.id('knowledgeCards')) },
	handler: async (ctx, { ids }) => {
		for (const id of ids) await ctx.db.patch(id, { status: 'suppressed' });
		return { suppressed: ids.length };
	}
});

/**
 * Re-classify published cards by their source topic and (optionally) retire the
 * ephemeral ones. Dry-run unless `apply: true`. Public dev tooling, run via:
 *   npx convex run curation:auditEphemeralPublished          # report only
 *   npx convex run curation:auditEphemeralPublished '{"apply":true}'
 * Reversible: suppressed cards can be set back to 'published'.
 */
export const auditEphemeralPublished = action({
	args: { apply: v.optional(v.boolean()) },
	handler: async (ctx, { apply }) => {
		const sources = await ctx.runQuery(internal.curation.listPublishedSources, {});
		const byTitle = new Map<string, Id<'knowledgeCards'>[]>();
		for (const { cardId, title } of sources) {
			const list = byTitle.get(title);
			if (list !== undefined) list.push(cardId);
			else byTitle.set(title, [cardId]);
		}

		const ephemeralIds: Id<'knowledgeCards'>[] = [];
		const samples: { title: string; count: number }[] = [];
		for (const [title, ids] of byTitle) {
			const verdict = await ctx.runAction(internal.ingest.classifyTitle, { title });
			if (verdict?.ephemeral === true) {
				ephemeralIds.push(...ids);
				samples.push({ title, count: ids.length });
			}
		}

		const applied =
			apply === true
				? (await ctx.runMutation(internal.curation.suppressCards, { ids: ephemeralIds })).suppressed
				: 0;

		return {
			scanned: sources.length,
			distinctTopics: byTitle.size,
			wouldSuppress: ephemeralIds.length,
			applied,
			samples: samples.slice(0, 20)
		};
	}
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test:convex -- curation`
Expected: PASS — round-trip + dry-run/apply tests green.

- [ ] **Step 5: Commit**

```bash
git add convex/curation.ts convex/curation.test.ts
git commit -m "feat(curation): reversible dry-run retire pass for ephemeral published cards"
```

---

### Task 4: Full verify + deploy classifier change to the dev backend

**Files:** none (verification + deploy step).

- [ ] **Step 1: Run the full offline gate**

Run: `bun run verify; echo "EXIT=$?"`
Expected: `EXIT=0` (typecheck + lint + unit + convex + component). Do NOT pipe through `tail` — it masks the exit code.

- [ ] **Step 2: Push the backend functions to the dev deployment (the live site uses Convex DEV)**

Run: `npx convex dev --once`
Expected: functions deploy without schema errors (no schema change in this plan, so no migration).

- [ ] **Step 3: Dry-run the retire pass against live data and review the report**

Run: `npx convex run curation:auditEphemeralPublished`
Expected: a report like `{ scanned, distinctTopics, wouldSuppress, applied: 0, samples: [...] }`. Eyeball `samples` — confirm they are genuinely ephemeral (e.g. "2026 Iran war") and not false positives (e.g. "Chernobyl disaster" must NOT appear). If a clearly-evergreen title appears, stop and revisit `isEphemeral` before applying.

- [ ] **Step 4: Apply the retire pass once the dry-run looks right**

Run: `npx convex run curation:auditEphemeralPublished '{"apply":true}'`
Expected: `applied` equals the prior `wouldSuppress`. The feed (serves only `published`) now excludes them. Reversible by setting any over-suppressed card back to `published`.

- [ ] **Step 5: Commit any incidental changes (e.g. generated api types)**

```bash
git add -A
git commit -m "chore(curation): regen api types after curation module" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**

- Recency dimension (Wikidata P585/P580/P571 + title token) → Task 1 (`isEphemeral`) + Task 2 (parsing). ✅
- Ephemeral beats allow, folded into `decideArticleStatus` → Task 1. ✅
- Flows through existing `evergreen` flag → Task 2 (`classifyTitle` returns `evergreen` derived from status; `classifyTopTopics` already calls `setEvergreen`). ✅
- `nowYear` injected, no `Date` in pure logic → Task 1 (param) + Task 2 (`getUTCFullYear` in handlers). ✅
- Reversible dry-run-first retire via `suppressed` → Task 3. ✅
- Fail-open on missing temporal data → Task 1 (`isEphemeral` with empty arrays) + Task 2 (`?? []`). ✅
- Cold-start auto-clean → no work needed (global default order already filters `evergreen !== false` / serves only `published`); noted. ✅
- Scope boundary (trending-people deferred to Approach B) → no task, intentional. ✅

**Deviation from spec (intentional, YAGNI):** the spec floated surfacing the retire pass in `/admin`. The plan instead exposes it as a public `action` runnable via `npx convex run`, matching the existing `ingest.ingestTitles` dev-tooling precedent — appropriate for an occasional maintenance sweep and far less surface area than a new admin route. The blanket `^List of ` title rule from the spec is dropped in favor of the year-token rule only, to avoid false-positiving evergreen lists ("List of chemical elements"); the target "List of attacks during the 2026 Iran war" is still caught by its year token.

**Placeholder scan:** none — every code/test step is complete.

**Type consistency:** `classifyTitle` returns `{ evergreen, ephemeral } | null` consistently in Task 2 (definition) and Task 3 (consumer reads `.ephemeral`). `decideArticleStatus` optional recency fields consistent across Tasks 1–2. `suppressCards`/`listPublishedSources`/`auditEphemeralPublished` signatures match between Task 3's interface block, implementation, and tests.
