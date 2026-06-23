# Topic Quality Signal (Evergreen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Add an `evergreen` verdict to catalog topics (reactive from generation + proactive Wikidata job) and filter suggestions / `needingCards` / discovery on `evergreen !== false`.

**Architecture:** Reuse `wikidataLogic.classifyTopic`/`decideArticleStatus` (already used by ingest). `evergreen` is optional on `topics` (undefined=unclassified); the three surfaces filter `q.neq(q.field('evergreen'), false)` in-query — no migration, no new index.

**Tech Stack:** Convex, TypeScript, Vitest + convex-test.

## Global Constraints

- `topics.evergreen: v.optional(v.boolean())`. Filter sites use `.filter((q) => q.neq(q.field('evergreen'), false))`. Search stays UNFILTERED.
- Reactive verdict: `evergreen = (ingestAndGenerate status !== 'filtered')`. Skip path doesn't set it.
- Proactive job reuses an extracted `ingest.classifyTitle` (no card generation/storage) + `classifyTopic`/`decideArticleStatus`.
- Convex: `internal*` privacy, explicit checks. After adding functions: `npx convex dev --once`. Tests: `bun run test:convex`. Before commit: `bun run check` + `bunx eslint <files>` (0).

---

### Task 1: schema + `evergreenFromStatus` + `setEvergreen`

**Files:** Modify `convex/schema.ts`, `convex/topicsLogic.ts`, `convex/topicsLogic.test.ts`, `convex/topics.ts`, `convex/topics.test.ts`.

- [ ] **Step 1: failing tests**

Append to `convex/topicsLogic.test.ts` (add `evergreenFromStatus` to the `./topicsLogic` import):

```ts
describe('evergreenFromStatus', () => {
	it('is false only for the ingest "filtered" status', () => {
		expect(evergreenFromStatus('filtered')).toBe(false);
		for (const s of ['published', 'exists', 'validation_failed', 'duplicate', 'skipped']) {
			expect(evergreenFromStatus(s)).toBe(true);
		}
	});
});
```

Append to `convex/topics.test.ts`:

```ts
test('setEvergreen patches the verdict on a topic', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Sportsperson',
		pageviews: 99,
		source: 'wikipedia-top'
	});
	await t.mutation(internal.topics.setEvergreen, { slug: 'sportsperson', evergreen: false });
	expect((await t.query(api.topics.bySlug, { slug: 'sportsperson' }))?.evergreen).toBe(false);
});
```

- [ ] **Step 2: run → fail.**

- [ ] **Step 3a: schema** — in `convex/schema.ts` `topics` table, add the field (alongside the others, before the indexes):

```ts
		evergreen: v.optional(v.boolean()),
```

- [ ] **Step 3b: `convex/topicsLogic.ts`** — add:

```ts
/** Catalog evergreen verdict from a generation result: only ingest's 'filtered'
 * (Wikidata non-evergreen / no free image) marks a topic as non-evergreen. */
export function evergreenFromStatus(status: string): boolean {
	return status !== 'filtered';
}
```

- [ ] **Step 3c: `convex/topics.ts`** — add (`internalMutation`/`v` already imported):

```ts
/** Record a topic's evergreen verdict. No-op if the slug isn't catalogued. */
export const setEvergreen = internalMutation({
	args: { slug: v.string(), evergreen: v.boolean() },
	handler: async (ctx, { slug, evergreen }) => {
		const topic = await ctx.db
			.query('topics')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.unique();
		if (topic !== null) await ctx.db.patch(topic._id, { evergreen, updatedAt: Date.now() });
	}
});
```

- [ ] **Step 4: regenerate + tests + checks** — `npx convex dev --once`; `npx vitest run --project convex convex/topicsLogic.test.ts convex/topics.test.ts` (PASS); `bun run check` (0); `bunx eslint convex/topicsLogic.ts convex/topics.ts` (0).
- [ ] **Step 5: commit** — `git add convex/schema.ts convex/topicsLogic.ts convex/topicsLogic.test.ts convex/topics.ts convex/topics.test.ts convex/_generated && git commit -m "feat(topics): evergreen field + evergreenFromStatus + setEvergreen"`

---

### Task 2: reactive recording + filter the three surfaces

**Files:** Modify `convex/generationPipeline.ts`, `convex/topics.ts`, `convex/topics.test.ts`, `convex/discovery.ts`, `convex/discovery.test.ts`.

- [ ] **Step 1: failing tests**

Append to `convex/topics.test.ts`:

```ts
test('topByPageviews and needingCards exclude evergreen===false (keep true + unclassified)', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Good',
		pageviews: 90,
		source: 'wikipedia-top'
	}); // undefined
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Junk',
		pageviews: 80,
		source: 'wikipedia-top'
	});
	await t.mutation(internal.topics.setEvergreen, { slug: 'junk', evergreen: false });
	await t.mutation(internal.topics.upsertTopic, {
		title: 'Verified',
		pageviews: 70,
		source: 'wikipedia-top'
	});
	await t.mutation(internal.topics.setEvergreen, { slug: 'verified', evergreen: true });

	const top = (await t.query(api.topics.topByPageviews, { limit: 10 })).map((r) => r.slug);
	expect(top).toEqual(['good', 'verified']); // junk excluded
	const needing = (await t.query(internal.topics.needingCards, { limit: 10 })).map((r) => r.slug);
	expect(needing).toEqual(['good', 'verified']);
});
```

Append to `convex/discovery.test.ts` — extend the existing seeded data: in the `t.run` block add a non-evergreen catalog topic and assert it's never discovered. Add after the existing `mk(...)` calls:

```ts
await mk('Junky', 'junky', 88); // also a morelike candidate below, but evergreen:false → excluded
```

then `await t.mutation(internal.topics.setEvergreen, { slug: 'junky', evergreen: false });` (import already present), add `{ title: 'Junky' }` to the stubbed morelike `search` array, and assert `'junky'` is NOT in the discovered slugs (the expected set stays `['carthage', 'hannibal', 'punic_wars']`).

- [ ] **Step 2: run → fail.**

- [ ] **Step 3a: reactive recording** — in `convex/generationPipeline.ts` `generateForTopic`, import `evergreenFromStatus` from `./topicsLogic`, and after the `ingestAndGenerate` call (the non-skip path), record the verdict. Final handler tail:

```ts
const r = await ctx.runAction(internal.generationPipeline.ingestAndGenerate, {
	title: topic.title
});
await ctx.runMutation(internal.topics.setEvergreen, {
	slug,
	evergreen: evergreenFromStatus(r.status)
});
if (publishedDelta(r.status) > 0) {
	await ctx.runMutation(internal.topics.incrementCardCount, { slug });
}
return { status: r.status };
```

- [ ] **Step 3b: filter `topByPageviews` + `needingCards`** in `convex/topics.ts` — add `.filter((q) => q.neq(q.field('evergreen'), false))` before `.take(...)` in BOTH:

```ts
// topByPageviews:
await ctx.db
	.query('topics')
	.withIndex('by_pageviews')
	.order('desc')
	.filter((q) => q.neq(q.field('evergreen'), false))
	.take(limit ?? 50);
// needingCards:
await ctx.db
	.query('topics')
	.withIndex('by_cardCount_pageviews', (q) => q.eq('cardCount', 0))
	.order('desc')
	.filter((q) => q.neq(q.field('evergreen'), false))
	.take(limit ?? 20);
```

- [ ] **Step 3c: filter discovery candidates** — in `convex/discovery.ts` `candidatesBySlugs`, change the push guard to also drop non-evergreen:

```ts
if (row !== null && row.evergreen !== false)
	out.push({ slug: row.slug, title: row.title, pageviews: row.pageviews });
```

- [ ] **Step 4: regenerate + tests + full suite + checks** — `npx convex dev --once`; `npx vitest run --project convex convex/topics.test.ts convex/discovery.test.ts` (PASS); `bun run test:convex` (full suite green); `bun run check` (0); `bunx eslint convex/generationPipeline.ts convex/topics.ts convex/discovery.ts` (0).
- [ ] **Step 5: commit** — `git add convex/generationPipeline.ts convex/topics.ts convex/topics.test.ts convex/discovery.ts convex/discovery.test.ts convex/_generated && git commit -m "feat(topics): record evergreen verdict + filter suggestions/needingCards/discovery"`

---

### Task 3: proactive classify job (`ingest.classifyTitle` + `classifyTopTopics`)

**Files:** Modify `convex/ingest.ts` (extract `classifyTitle`); `convex/topics.ts` (`unclassifiedTopByPageviews` + `classifyTopTopics`); Test: `convex/ingest.test.ts` (or `convex/topics.test.ts`).

**Interfaces:** `internal.ingest.classifyTitle({title})` → `{evergreen: boolean} | null`; `internal.topics.unclassifiedTopByPageviews({limit})`; `api.topics.classifyTopTopics({limit})` → `{classified}`.

- [ ] **Step 1: study ingest** — READ `convex/ingest.ts`, specifically `ingestOne`/`ingestTitles` (~lines 184–280): how it fetches the article (categories + `pageprops` wikibase QID) via `ACTION_API`, calls `fetchWikidataClaims(...)`, then `classifyTopic(claims)` + `decideArticleStatus({verdict, categories})` to get `status: 'fetched' | 'filtered_out'`. `classifyTitle` will reuse exactly this (minus extract/storage/image/generation).

- [ ] **Step 2: failing test** — `convex/ingest.test.ts` (fetch-stubbed): stub the article fetch + Wikidata so a title resolves to a BLOCK class (e.g. film `Q11424`) → `classifyTitle` returns `{evergreen: false}`; and an ALLOW/evergreen case → `{evergreen: true}`. (Mirror the stubbing shape `fetchWikidataClaims`/the article fetch expect; read ingest to get the exact response shapes. If the two MediaWiki calls are hard to stub distinctly, stub by URL substring.)

- [ ] **Step 3a: `convex/ingest.ts`** — extract an exported `classifyTitle` internalAction:

```ts
export const classifyTitle = internalAction({
	args: { title: v.string() },
	handler: async (ctx, { title }): Promise<{ evergreen: boolean } | null> => {
		// Fetch the article's content categories + wikibase QID (same ACTION_API
		// query ingest already uses), then fetchWikidataClaims(QID), then classify.
		// Reuse the existing helpers; do NOT extract text, fetch images, store, or generate.
		// Return null if the article/page can't be resolved.
		// (Implementer: factor the classification half out of ingestTitles' loop —
		// the part producing { status, basis } via classifyTopic + decideArticleStatus —
		// and map status: 'fetched' → evergreen:true, 'filtered_out' → evergreen:false.)
	}
});
```

Keep `ingestTitles`/`ingestOne` behavior identical (have them call the shared classification helper if a clean extraction is natural; otherwise leave them and add `classifyTitle` alongside, reusing `fetchWikidataClaims` + the article fetch). Do not change generation behavior.

- [ ] **Step 3b: `convex/topics.ts`** — add:

```ts
/** Most-popular topics not yet classified (evergreen unset). */
export const unclassifiedTopByPageviews = internalQuery({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) =>
		await ctx.db
			.query('topics')
			.withIndex('by_pageviews')
			.order('desc')
			.filter((q) => q.eq(q.field('evergreen'), undefined))
			.take(limit ?? 50)
});

/** Proactively classify the top unclassified topics via Wikidata (bounded; ops/cron). */
export const classifyTopTopics = action({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }): Promise<{ classified: number }> => {
		const todo = await ctx.runQuery(internal.topics.unclassifiedTopByPageviews, {
			limit: limit ?? 50
		});
		let classified = 0;
		for (const topic of todo) {
			const r = await ctx.runAction(internal.ingest.classifyTitle, { title: topic.title });
			if (r !== null) {
				await ctx.runMutation(internal.topics.setEvergreen, {
					slug: topic.slug,
					evergreen: r.evergreen
				});
				classified++;
			}
		}
		return { classified };
	}
});
```

(`action` import: add to `topics.ts`'s `_generated/server` import if not present.)

- [ ] **Step 4: regenerate + tests + full suite + checks** — `npx convex dev --once`; run the new test (PASS); `bun run test:convex` (full suite green); `bun run check` (0); `bunx eslint convex/ingest.ts convex/topics.ts` (0).
- [ ] **Step 5: commit** — `git add convex/ingest.ts convex/topics.ts convex/*.test.ts convex/_generated && git commit -m "feat(topics): proactive evergreen classification (classifyTitle + classifyTopTopics)"`

---

## Post-implementation (controller)

Deploy + push; run `npx convex run topics:classifyTopTopics '{"limit":300}'` in passes to classify the suggestion-relevant top topics; then confirm `topByPageviews` is cleaner (fewer sports/crime) and reload onboarding. The reactive verdict + hourly generation cron keep classifying over time.

## Coverage boundary

`classifyTitle`'s live MediaWiki/Wikidata calls aren't unit-tested (fetch-stubbed test covers the logic); the post-deploy `classifyTopTopics` run validates the live path — matching the project's network-orchestration precedent.
