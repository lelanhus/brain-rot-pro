# Auto-Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** When a user follows a topic, auto-add up to 3 related catalog topics as `discovered` interests (via Wikipedia morelike, catalog-gated), broadening the blended feed.

**Architecture:** `discovery.discoverFor` (scheduled from `interests.add`) fetches related titles, maps to catalog slugs, filters/ranks via pure `pickDiscoveries`, and adds them via `interests.addDiscovered`. Reuses SP3 feed boost + SP2 generation; no feed/generation changes.

**Tech Stack:** Convex (actions/mutations/queries), TypeScript, Vitest + convex-test.

## Global Constraints

- Relatedness via MediaWiki `srsearch=morelike:<title>` (reuse `USER_AGENT` + `https://en.wikipedia.org/w/api.php`, per `ingest.ts`). Best-effort: return `[]` on any failure.
- Catalog-gate candidates (must exist in `topics` by slug); drop already-followed; rank by `pageviews` desc; cap **3** per follow.
- Discovered interests: `source:'discovered'`, schedule `generateForTopic`, **never** schedule discovery (no recursion). Display title with underscores→spaces.
- `interests.add` (explicit) schedules `discoverFor`. No new feed/generation logic.
- Convex conventions: `internal*` privacy, explicit `=== null`/`> 0`. After adding/removing functions: `npx convex dev --once`. Tests: `bun run test:convex`. Before commit: `bun run check` + `bunx eslint <files>` (0).

---

### Task 1: pure `pickDiscoveries` + `interests.addDiscovered`

**Files:** Create `convex/discoveryLogic.ts`, `convex/discoveryLogic.test.ts`; Modify `convex/interests.ts`, `convex/interests.test.ts`.

**Interfaces produced:** `pickDiscoveries(candidates, followed, limit)`; `internal.interests.addDiscovered({deviceId,slug,title})`.

- [ ] **Step 1: failing tests**

`convex/discoveryLogic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pickDiscoveries } from './discoveryLogic';

describe('pickDiscoveries', () => {
	const c = (slug: string, pageviews: number) => ({ slug, title: slug, pageviews });
	it('drops followed, dedupes by slug, sorts by pageviews desc, caps at limit', () => {
		const cands = [c('a', 10), c('b', 50), c('b', 50), c('c', 30), c('d', 99)];
		const picks = pickDiscoveries(cands, new Set(['d']), 2);
		expect(picks.map((p) => p.slug)).toEqual(['b', 'c']); // d followed; b>c by views; cap 2
	});
	it('returns [] when all followed', () => {
		expect(pickDiscoveries([c('a', 5)], new Set(['a']), 3)).toEqual([]);
	});
});
```

Append to `convex/interests.test.ts`:

```ts
import { internal } from './_generated/api';

test('addDiscovered inserts a discovered interest and dedupes', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'dd';
	await t.mutation(internal.interests.addDiscovered, { deviceId, slug: 'rome', title: 'Rome' });
	await t.mutation(internal.interests.addDiscovered, { deviceId, slug: 'rome', title: 'Rome' });
	const rows = await t.query(api.interests.list, { deviceId });
	expect(rows).toHaveLength(1);
	expect(rows[0].source).toBe('discovered');
});
```

(Add the `internal` import if `interests.test.ts` doesn't already import it.)

- [ ] **Step 2: run → fail.**

- [ ] **Step 3a: `convex/discoveryLogic.ts`:**

```ts
/**
 * Pick up to `limit` discovery candidates: drop already-followed slugs, dedupe by
 * slug (first wins), rank by pageviews desc.
 */
export function pickDiscoveries(
	candidates: { slug: string; title: string; pageviews: number }[],
	followed: ReadonlySet<string>,
	limit: number
): { slug: string; title: string }[] {
	const bySlug = new Map<string, { slug: string; title: string; pageviews: number }>();
	for (const c of candidates) {
		if (followed.has(c.slug) || bySlug.has(c.slug)) continue;
		bySlug.set(c.slug, c);
	}
	return [...bySlug.values()]
		.sort((a, b) => b.pageviews - a.pageviews)
		.slice(0, limit)
		.map(({ slug, title }) => ({ slug, title }));
}
```

- [ ] **Step 3b: `convex/interests.ts`** — add `addDiscovered` (and ensure `internal` is imported — it already is for `add`):

```ts
/** Add a discovered interest (from auto-discovery). Dedupes; schedules generation; does NOT trigger further discovery. */
export const addDiscovered = internalMutation({
	args: { deviceId: v.string(), slug: v.string(), title: v.string() },
	handler: async (ctx, { deviceId, slug, title }) => {
		const existing = await ctx.db
			.query('interests')
			.withIndex('by_device_slug', (q) => q.eq('deviceId', deviceId).eq('slug', slug))
			.unique();
		if (existing !== null) return;
		await ctx.db.insert('interests', {
			deviceId,
			slug,
			title,
			source: 'discovered',
			createdAt: Date.now()
		});
		await ctx.scheduler.runAfter(0, internal.generationPipeline.generateForTopic, { slug });
	}
});
```

(Add `internalMutation` to the `_generated/server` import in `interests.ts` if not already present — `add`/`remove` use `mutation`; `query` for `list`. Add `internalMutation`.)

- [ ] **Step 4: regenerate + tests + checks** — `npx convex dev --once`; `npx vitest run --project convex convex/discoveryLogic.test.ts convex/interests.test.ts` (PASS); `bun run check` (0); `bunx eslint convex/discoveryLogic.ts convex/interests.ts` (0).
- [ ] **Step 5: commit** — `git add convex/discoveryLogic.ts convex/discoveryLogic.test.ts convex/interests.ts convex/interests.test.ts convex/_generated && git commit -m "feat(discovery): pickDiscoveries + interests.addDiscovered"`

---

### Task 2: `discovery.discoverFor` + trigger from `interests.add`

**Files:** Create `convex/discovery.ts`, `convex/discovery.test.ts`; Modify `convex/interests.ts`.

**Interfaces:** Consumes `pickDiscoveries`, `internal.interests.addDiscovered`, `internal.discovery.candidatesBySlugs`, `api.interests.list`, `toSlug`. Produces `internal.discovery.discoverFor({deviceId,slug,title})`.

- [ ] **Step 1: failing test** — `convex/discovery.test.ts` (stubs `fetch` so morelike is deterministic/offline):

```ts
import { convexTest } from 'convex-test';
import { expect, test, vi } from 'vitest';
import { internal, api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('discoverFor adds up to 3 catalog-present, unfollowed related topics', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'dx';
	// Catalog has Rome (followed already), Carthage, Hannibal, Punic_Wars (candidates), but not "Random Title".
	await t.run(async (ctx) => {
		const mk = (title: string, slug: string, pageviews: number) =>
			ctx.db.insert('topics', {
				title,
				slug,
				pageviews,
				cardCount: 0,
				source: 'wikipedia-top',
				updatedAt: 1
			});
		await mk('Carthage', 'carthage', 50);
		await mk('Hannibal', 'hannibal', 90);
		await mk('Punic Wars', 'punic_wars', 30);
	});
	await t.mutation(internal.interests.addDiscovered, {
		deviceId,
		slug: 'hannibal',
		title: 'Hannibal'
	}); // already followed → must be skipped

	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				({
					ok: true,
					json: async () => ({
						query: {
							search: [
								{ title: 'Carthage' },
								{ title: 'Hannibal' },
								{ title: 'Punic Wars' },
								{ title: 'Random Title' }
							]
						}
					})
				}) as unknown as Response
		)
	);

	const res = await t.action(internal.discovery.discoverFor, {
		deviceId,
		slug: 'rome',
		title: 'Rome'
	});
	// Hannibal followed; Random Title not in catalog → Carthage + Punic Wars discovered (cap 3).
	expect(res.discovered).toBe(2);
	const slugs = (await t.query(api.interests.list, { deviceId })).map((i) => i.slug).sort();
	expect(slugs).toEqual(['carthage', 'hannibal', 'punic_wars']);
	vi.unstubAllGlobals();
});
```

- [ ] **Step 2: run → fail.**

- [ ] **Step 3a: `convex/discovery.ts`:**

```ts
import { internalAction, internalQuery } from './_generated/server';
import { api, internal } from './_generated/api';
import { v } from 'convex/values';
import { toSlug } from './topicsLogic';
import { pickDiscoveries } from './discoveryLogic';

const ACTION_API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT =
	'BrainRotPro/0.1 (https://github.com/lelanhus/brain-rot-pro; leland.husband@gmail.com)';

/** Related article titles via MediaWiki morelike search. Best-effort: [] on any failure. */
async function relatedTitles(title: string): Promise<string[]> {
	try {
		const params = new URLSearchParams({
			action: 'query',
			list: 'search',
			srsearch: `morelike:${title}`,
			srlimit: '12',
			format: 'json',
			origin: '*'
		});
		const res = await fetch(`${ACTION_API}?${params.toString()}`, {
			headers: { 'User-Agent': USER_AGENT }
		});
		if (!res.ok) return [];
		const data = (await res.json()) as { query?: { search?: { title: string }[] } };
		return (data.query?.search ?? []).map((s) => s.title).filter((tt) => tt !== title);
	} catch {
		return [];
	}
}

/** Catalog rows for the given slugs (only those that exist). */
export const candidatesBySlugs = internalQuery({
	args: { slugs: v.array(v.string()) },
	handler: async (ctx, { slugs }) => {
		const out: { slug: string; title: string; pageviews: number }[] = [];
		for (const slug of slugs) {
			const row = await ctx.db
				.query('topics')
				.withIndex('by_slug', (q) => q.eq('slug', slug))
				.unique();
			if (row !== null) out.push({ slug: row.slug, title: row.title, pageviews: row.pageviews });
		}
		return out;
	}
});

/** Broaden interests: find catalog topics related to a just-followed topic and add the top 3 as 'discovered'. */
export const discoverFor = internalAction({
	args: { deviceId: v.string(), slug: v.string(), title: v.string() },
	handler: async (ctx, { deviceId, title }): Promise<{ discovered: number }> => {
		const titles = await relatedTitles(title);
		if (titles.length === 0) return { discovered: 0 };
		const slugs = titles.map(toSlug);
		const candidates = await ctx.runQuery(internal.discovery.candidatesBySlugs, { slugs });
		const followedRows = await ctx.runQuery(api.interests.list, { deviceId });
		const followed = new Set<string>(followedRows.map((i) => i.slug));
		const picks = pickDiscoveries(candidates, followed, 3);
		for (const p of picks) {
			await ctx.runMutation(internal.interests.addDiscovered, {
				deviceId,
				slug: p.slug,
				title: p.title.replace(/_/g, ' ')
			});
		}
		return { discovered: picks.length };
	}
});
```

- [ ] **Step 3b: trigger from `interests.add`** — in `convex/interests.ts`, in `add`'s handler, after the existing `generateForTopic` schedule, add the discovery schedule (only fires on a NEW explicit insert, since it's after the `existing !== null` early return):

```ts
await ctx.scheduler.runAfter(0, internal.discovery.discoverFor, { deviceId, slug, title });
```

- [ ] **Step 4: regenerate + tests + full suite + checks** — `npx convex dev --once`; `npx vitest run --project convex convex/discovery.test.ts` (PASS — discovered 2, the followed/non-catalog dropped); `bun run test:convex` (full suite green); `bun run check` (0); `bunx eslint convex/discovery.ts convex/interests.ts` (0).
- [ ] **Step 5: commit** — `git add convex/discovery.ts convex/discovery.test.ts convex/interests.ts convex/_generated && git commit -m "feat(discovery): discoverFor (morelike→catalog) + trigger from interests.add"`

---

## Post-implementation (controller)

Deploy + push; verify like a human: follow a topic (e.g. via /search or a card), wait a moment, then confirm 1–3 NEW `source:'discovered'` interests appear in /account Interests (and/or via `npx convex run` data check). morelike + scheduling is the coverage boundary (network) — this manual check validates the live path.

## Coverage boundary

`relatedTitles`'s real network call is not exercised in unit tests; the `discovery.test.ts` stubs `fetch` to cover `discoverFor`'s full orchestration (catalog-gate, followed-drop, cap, addDiscovered) offline. The live morelike call is validated by the controller's post-deploy check.
