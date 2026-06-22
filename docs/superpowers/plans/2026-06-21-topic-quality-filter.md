# Topic Quality Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Reject clear-junk topic titles (TLDs, "Deaths in …", "YYYY in …") at harvest, and purge existing junk from the catalog.

**Architecture:** A pure `isQualityTopic` predicate gates `harvestTopDay`; a one-time `purgeLowQuality` cleans the current catalog. No per-read filtering.

**Tech Stack:** Convex, TypeScript, Vitest + convex-test.

## Global Constraints
- Conservative title-shape filter only (no quality classifier). Reject: TLD `^\.[a-z]{2,}$`, "Deaths in …" `^deaths? in`, "YYYY in …" `^\d{3,4}[ _]+in[ _]`. Everything else passes (year-prefix events like "2026 FIFA World Cup" must PASS).
- Catalog stays the clean source (filter at write + purge); no changes to `topByPageviews`/`search`/`needingCards`.
- Convex: `internal*` for the purge; explicit checks. After adding functions: `npx convex dev --once`. Tests: `bun run test:convex`. Before commit: `bun run check` + `bunx eslint <files>` (0).

---

### Task 1: `isQualityTopic` + harvest gate + `purgeLowQuality`

**Files:** Modify `convex/topicsLogic.ts`, `convex/topicsLogic.test.ts`, `convex/topics.ts`, `convex/topics.test.ts`.

- [ ] **Step 1: failing tests**

Append to `convex/topicsLogic.test.ts` (add `isQualityTopic` to the existing `./topicsLogic` import):
```ts
describe('isQualityTopic', () => {
	it('rejects TLDs, Deaths-in, and YYYY-in ranking pages', () => {
		expect(isQualityTopic('.xyz')).toBe(false);
		expect(isQualityTopic('.xxx')).toBe(false);
		expect(isQualityTopic('Deaths in 2026')).toBe(false);
		expect(isQualityTopic('2008_in_music')).toBe(false);
		expect(isQualityTopic('2026 in film')).toBe(false);
	});
	it('accepts real subjects incl. year-prefix events', () => {
		expect(isQualityTopic('Cleopatra')).toBe(true);
		expect(isQualityTopic('Cristiano Ronaldo')).toBe(true);
		expect(isQualityTopic('Cape Verde')).toBe(true);
		expect(isQualityTopic('2026 FIFA World Cup')).toBe(true);
		expect(isQualityTopic('ChatGPT')).toBe(true);
	});
});
```

Append to `convex/topics.test.ts`:
```ts
test('purgeLowQuality deletes junk topics and keeps quality ones', async () => {
	const t = convexTest(schema, modules);
	await t.run(async (ctx) => {
		const mk = (title: string, slug: string) =>
			ctx.db.insert('topics', { title, slug, pageviews: 10, cardCount: 0, source: 'wikipedia-top', updatedAt: 1 });
		await mk('.xyz', '.xyz');
		await mk('Deaths in 2026', 'deaths_in_2026');
		await mk('Cleopatra', 'cleopatra');
		await mk('Cristiano Ronaldo', 'cristiano_ronaldo');
	});
	const res = await t.mutation(internal.topics.purgeLowQuality, {});
	expect(res.deleted).toBe(2);
	const left = await t.run(async (ctx) => ctx.db.query('topics').collect());
	expect(left.map((r) => r.slug).sort()).toEqual(['cleopatra', 'cristiano_ronaldo']);
});
```
(Ensure `internal` is imported in `topics.test.ts` — it is, from earlier tasks.)

- [ ] **Step 2: run → fail** (`npx vitest run --project convex convex/topicsLogic.test.ts convex/topics.test.ts`).

- [ ] **Step 3a: `convex/topicsLogic.ts`** — add the predicate:
```ts
const TLD_RE = /^\.[a-z]{2,}$/i;
const DEATHS_RE = /^deaths?\s+in\b/i;
const YEAR_IN_RE = /^\d{3,4}[\s_]+in[\s_]/i;

/**
 * Quality gate (stricter than the structural isRealArticleTitle): rejects clear
 * junk topic titles — TLDs (.xyz), "Deaths in …", and "YYYY in …" ranking pages.
 * Conservative: real subjects (people, places, films, year-prefix events) pass.
 */
export function isQualityTopic(title: string): boolean {
	const t = title.trim();
	if (TLD_RE.test(t)) return false;
	if (DEATHS_RE.test(t)) return false;
	if (YEAR_IN_RE.test(t)) return false;
	return true;
}
```

- [ ] **Step 3b: `convex/topics.ts` harvest gate** — add `isQualityTopic` to the `./topicsLogic` import. In `harvestTopDay`'s loop, change the filter line:
```ts
// before:  if (!isRealArticleTitle(a.article)) continue;
// after:
			if (!isRealArticleTitle(a.article) || !isQualityTopic(a.article)) continue;
```

- [ ] **Step 3c: `convex/topics.ts` purge** — add:
```ts
/** One-time: remove catalog topics whose title fails the quality gate. */
export const purgeLowQuality = internalMutation({
	args: {},
	handler: async (ctx): Promise<{ deleted: number }> => {
		const all = await ctx.db.query('topics').collect();
		let deleted = 0;
		for (const topic of all) {
			if (!isQualityTopic(topic.title)) {
				await ctx.db.delete(topic._id);
				deleted++;
			}
		}
		return { deleted };
	}
});
```
(`internalMutation` is already imported in `topics.ts`.)

- [ ] **Step 4: regenerate + tests + full suite + checks** — `npx convex dev --once`; `npx vitest run --project convex convex/topicsLogic.test.ts convex/topics.test.ts` (PASS); `bun run test:convex` (full suite green); `bun run check` (0); `bunx eslint convex/topicsLogic.ts convex/topics.ts` (0).

- [ ] **Step 5: commit** — `git add convex/topicsLogic.ts convex/topicsLogic.test.ts convex/topics.ts convex/topics.test.ts convex/_generated && git commit -m "feat(topics): isQualityTopic gate at harvest + purgeLowQuality"`

---

## Post-implementation (controller)
Deploy (`npx convex dev --once`) + push; run `npx convex run topics:purgeLowQuality` to clean the existing catalog; then data-check `topByPageviews` no longer returns TLDs/"Deaths in", and reload onboarding for cleaner suggestions.

## Coverage boundary
Pure predicate + purge are unit/convex-tested; the live harvest gate is exercised by the existing harvestTopDay test pattern + the post-deploy data check.
