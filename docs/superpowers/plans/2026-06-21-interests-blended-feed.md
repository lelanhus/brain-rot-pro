# Interests + Blended Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Let users follow catalog topics; blend those explicit interests into the For-You feed ranking; manage them on /account.

**Architecture:** New `interests` table (deviceId+slug) with add/remove/list (add schedules `generateForTopic`). `feed.unseen` loads interest slugs and the pure `scoreByTaste` adds `INTEREST_BOOST` to followed topics' cards. A follow toggle on each card; an interests panel on /account.

**Tech Stack:** Convex, SvelteKit/Svelte 5 runes, Vitest + convex-test.

## Global Constraints

- Interests are catalog topic slugs; card↔topic via `toSlug(card.source.articleTitle)`.
- `INTEREST_BOOST = 5` (single named const in `profileLogic.ts`; nudges, doesn't dominate — RELEVANCE_WEIGHT=10, FOCUS_BOOST=100).
- Per-device (`deviceId`). Anonymous-first; no auth required.
- `add` is idempotent (dedupe by device+slug) and schedules `internal.generationPipeline.generateForTopic` once on new insert.
- Convex conventions: `internal*` privacy, explicit `=== undefined`/`!== null`. After adding/removing functions run `npx convex dev --once` to regenerate `_generated`. Tests: `bun run test:convex` / `bun run test:component`. Before commit: `bun run check` + `bunx eslint <changed files>` (0 errors).
- YAGNI: no search/onboarding/discovery here.

---

### Task 1: `interests` model

**Files:** Modify `convex/schema.ts`; Create `convex/interests.ts`, `convex/interests.test.ts`.

**Interfaces produced:**

- table `interests` `{ deviceId, slug, title, source, createdAt }` indexes `by_device`, `by_device_slug`.
- `api.interests.add({ deviceId, slug, title })` → void (idempotent; schedules generateForTopic on new).
- `api.interests.remove({ deviceId, slug })` → void.
- `api.interests.list({ deviceId })` → `Doc<'interests'>[]` (newest first).

- [ ] **Step 1: failing test** — append `convex/interests.test.ts`:

```ts
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('interests add (idempotent) / list / remove', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'dev1';
	await t.mutation(api.interests.add, { deviceId, slug: 'cleopatra', title: 'Cleopatra' });
	await t.mutation(api.interests.add, { deviceId, slug: 'cleopatra', title: 'Cleopatra' }); // dedupe
	let rows = await t.query(api.interests.list, { deviceId });
	expect(rows).toHaveLength(1);
	expect(rows[0].slug).toBe('cleopatra');
	expect(rows[0].source).toBe('explicit');

	await t.mutation(api.interests.remove, { deviceId, slug: 'cleopatra' });
	rows = await t.query(api.interests.list, { deviceId });
	expect(rows).toHaveLength(0);
});
```

- [ ] **Step 2: run → fail** (`npx vitest run --project convex convex/interests.test.ts`).

- [ ] **Step 3a: schema** — add to `convex/schema.ts` inside `defineSchema`:

```ts
	interests: defineTable({
		deviceId: v.string(),
		slug: v.string(),
		title: v.string(),
		source: v.string(), // 'explicit' | 'discovered'
		createdAt: v.number()
	})
		.index('by_device', ['deviceId'])
		.index('by_device_slug', ['deviceId', 'slug']),
```

- [ ] **Step 3b: `convex/interests.ts`:**

```ts
import { mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';

/** Follow a catalog topic. Idempotent per device+slug; schedules generation so the topic has a card. */
export const add = mutation({
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
			source: 'explicit',
			createdAt: Date.now()
		});
		await ctx.scheduler.runAfter(0, internal.generationPipeline.generateForTopic, { slug });
	}
});

export const remove = mutation({
	args: { deviceId: v.string(), slug: v.string() },
	handler: async (ctx, { deviceId, slug }) => {
		const row = await ctx.db
			.query('interests')
			.withIndex('by_device_slug', (q) => q.eq('deviceId', deviceId).eq('slug', slug))
			.unique();
		if (row !== null) await ctx.db.delete(row._id);
	}
});

export const list = query({
	args: { deviceId: v.string() },
	handler: async (ctx, { deviceId }) =>
		await ctx.db
			.query('interests')
			.withIndex('by_device', (q) => q.eq('deviceId', deviceId))
			.order('desc')
			.collect()
});
```

- [ ] **Step 4: regenerate + test + checks** — `npx convex dev --once`; `npx vitest run --project convex convex/interests.test.ts` (PASS); `bun run check` (0); `bunx eslint convex/interests.ts` (0).
- [ ] **Step 5: commit** — `git add convex/schema.ts convex/interests.ts convex/interests.test.ts convex/_generated && git commit -m "feat(interests): interests table + add/remove/list"`

---

### Task 2: blended feed (INTEREST_BOOST)

**Files:** Modify `convex/profileLogic.ts`, `convex/profileLogic.test.ts`, `convex/feed.ts`, `convex/feed.test.ts`.

**Interfaces:**

- Consumes: `interests` table; `toSlug` (`convex/topicsLogic.ts`).
- Produces: `INTEREST_BOOST` const; `scoreByTaste(card{conceptTags,embedding,slug?}, ctx{...,interestSlugs?: ReadonlySet<string>})` adds the boost.

- [ ] **Step 1: failing test** — append `convex/profileLogic.test.ts`:

```ts
import { INTEREST_BOOST } from './profileLogic';

describe('scoreByTaste interest boost', () => {
	const base = { conceptTags: ['x'], embedding: undefined, slug: 'cleopatra' };
	const ctx = { tasteVector: undefined, weights: {}, shuffleKey: 0, focusConcept: null };
	it('adds INTEREST_BOOST iff the card slug is followed', () => {
		const followed = new Set(['cleopatra']);
		const withBoost = scoreByTaste(base, { ...ctx, interestSlugs: followed });
		const without = scoreByTaste(base, { ...ctx, interestSlugs: new Set() });
		expect(withBoost - without).toBeCloseTo(INTEREST_BOOST);
	});
});
```

(`scoreByTaste` is already imported in this test file; add `INTEREST_BOOST` to that import if it shares a line.)

- [ ] **Step 2: run → fail.**

- [ ] **Step 3a: `convex/profileLogic.ts`** — add const + thread the boost. Add near the other consts:

```ts
/** Additive rank bump for cards whose source topic the user explicitly follows. */
export const INTEREST_BOOST = 5;
```

Replace `scoreByTaste` with (adds `slug?` to card, `interestSlugs?` to ctx, applies boost on both branches):

```ts
export function scoreByTaste(
	card: { conceptTags: string[]; embedding?: number[]; slug?: string },
	ctx: {
		tasteVector?: number[];
		weights: Record<string, number>;
		shuffleKey: number;
		focusConcept?: string | null;
		interestSlugs?: ReadonlySet<string>;
	}
): number {
	const emb = card.embedding;
	let score: number;
	if (ctx.tasteVector !== undefined && emb !== undefined && emb.length === ctx.tasteVector.length) {
		score = RELEVANCE_WEIGHT * cosineSimilarity(ctx.tasteVector, emb);
		score += WILDCARD_WEIGHT * ctx.shuffleKey;
		if (ctx.focusConcept && card.conceptTags.includes(ctx.focusConcept)) score += FOCUS_BOOST;
	} else {
		score = scoreCard(card.conceptTags, ctx.weights, {
			shuffleKey: ctx.shuffleKey,
			focusConcept: ctx.focusConcept
		});
	}
	if (
		ctx.interestSlugs !== undefined &&
		card.slug !== undefined &&
		ctx.interestSlugs.has(card.slug)
	) {
		score += INTEREST_BOOST;
	}
	return score;
}
```

- [ ] **Step 3b: `convex/feed.ts`** — import `toSlug`, load interest slugs, pass to scoreByTaste. Add import: `import { toSlug } from './topicsLogic';`. After building `notInterested`, add:

```ts
const interestSlugs = new Set<string>();
if (args.deviceId.length > 0) {
	const ints = await ctx.db
		.query('interests')
		.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
		.collect();
	for (const i of ints) interestSlugs.add(i.slug);
}
```

Change the two `scoreByTaste(x, { ... })` calls to include `slug` + `interestSlugs`:

```ts
scoreByTaste(
	{ conceptTags: b.conceptTags, embedding: b.embedding, slug: toSlug(b.source.articleTitle) },
	{ tasteVector, weights, shuffleKey: b.shuffleKey, focusConcept: args.focusConcept, interestSlugs }
) -
	scoreByTaste(
		{ conceptTags: a.conceptTags, embedding: a.embedding, slug: toSlug(a.source.articleTitle) },
		{
			tasteVector,
			weights,
			shuffleKey: a.shuffleKey,
			focusConcept: args.focusConcept,
			interestSlugs
		}
	);
```

- [ ] **Step 3c: feed integration test** — append `convex/feed.test.ts` (use its existing convex-test harness pattern). Seed two published cards with embeddings absent (so scoreCard fallback) but DISTINCT shuffleKeys, follow the lower-shuffle card's topic, assert it now ranks first:

```ts
test('feed.unseen boosts a followed topic above an equivalent unfollowed card', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'd1';
	const ids = await t.run(async (ctx) => {
		const mk = (articleTitle: string, shuffleKey: number) =>
			ctx.db.insert('knowledgeCards', {
				hook: 'h',
				body: 'b',
				format: 'surprise_fact' as const,
				conceptTags: ['z'],
				source: { articleTitle, articleUrl: 'u', revisionId: null, sourceSpan: 's' },
				status: 'published' as const,
				shuffleKey,
				createdAt: 1
			});
		return { low: await mk('Low Topic', 0.1), high: await mk('High Topic', 0.9) };
	});
	// Without follow, High (shuffle .9) ranks first. Follow Low's topic → it should jump ahead.
	await t.mutation(api.interests.add, { deviceId, slug: 'low_topic', title: 'Low Topic' });
	const res = await t.query(api.feed.unseen, {
		deviceId,
		paginationOpts: { numItems: 10, cursor: null }
	});
	expect(res.page[0]._id).toBe(ids.low);
});
```

- [ ] **Step 4: regenerate + tests + checks** — `npx convex dev --once`; `npx vitest run --project convex convex/profileLogic.test.ts convex/feed.test.ts` (PASS); `bun run check` (0); `bunx eslint convex/profileLogic.ts convex/feed.ts` (0).
- [ ] **Step 5: commit** — `git add convex/profileLogic.ts convex/profileLogic.test.ts convex/feed.ts convex/feed.test.ts convex/_generated && git commit -m "feat(feed): blend explicit interests (INTEREST_BOOST)"`

---

### Task 3: UI — follow toggle + /account interests panel

**Files:** Create `src/lib/slug.ts`; Modify `src/lib/components/CardActions.svelte`, `src/routes/+page.svelte`, `src/routes/account/+page.svelte`.

**Interfaces consumed:** `api.interests.{add,remove,list}`.

- [ ] **Step 1: client slug helper** — create `src/lib/slug.ts` (mirror of `convex/topicsLogic.toSlug`; keep in sync):

```ts
/** Topic slug — MUST match convex/topicsLogic.ts toSlug (kept in sync intentionally). */
export function toSlug(title: string): string {
	return title
		.trim()
		.replace(/\s+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '')
		.toLowerCase();
}
```

- [ ] **Step 2: CardActions follow button** — add `following`/`onFollow` props and a button. In the `$props()` destructure add `following: boolean;` and `onFollow: () => void;`. Add this button after the Save button:

```svelte
<button
	type="button"
	class="action"
	class:active={following}
	aria-pressed={following}
	aria-label={following ? 'Following topic — tap to unfollow' : 'Follow topic'}
	title={following ? 'Following topic' : 'Follow topic'}
	onclick={onFollow}
>
	<svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
		<path
			d="M12 21s-7-4.35-9.5-8.5C1 9 3 5 6.5 5 9 5 12 8 12 8s3-3 5.5-3C21 5 23 9 21.5 12.5 19 16.65 12 21 12 21z"
			fill={following ? 'currentColor' : 'none'}
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linejoin="round"
		/>
	</svg>
	<span class="vh">{following ? 'Following topic' : 'Follow topic'}</span>
</button>
```

- [ ] **Step 3: wire follow in `src/routes/+page.svelte`** — mirror the saved pattern. Add imports `import { toSlug } from '$lib/slug';`. Add near `savedQuery`:

```ts
const interestsQuery = useQuery(api.interests.list, () => (deviceId ? { deviceId } : 'skip'));
const followedSlugs = $derived(new Set<string>((interestsQuery.data ?? []).map((i) => i.slug)));
const addInterest = useMutation(api.interests.add);
const removeInterest = useMutation(api.interests.remove);
function toggleFollow(card: Doc<'knowledgeCards'>) {
	if (!deviceId) return;
	const slug = toSlug(card.source.articleTitle);
	if (followedSlugs.has(slug)) void removeInterest({ deviceId, slug });
	else void addInterest({ deviceId, slug, title: card.source.articleTitle });
}
```

Pass to the `<CardActions ... />` render: `following={followedSlugs.has(toSlug(activeCard.source.articleTitle))}` and `onFollow={() => toggleFollow(activeCard)}`.

- [ ] **Step 4: /account interests panel** — in `src/routes/account/+page.svelte`, add a panel (mirror existing panels). Add near other queries: `const interests = useQuery(api.interests.list, () => (deviceId ? { deviceId } : 'skip'));` and `const removeInterest = useMutation(api.interests.remove);`. Add the panel markup (place after "Cross-device sync"):

```svelte
<section class="panel">
	<h2>Interests</h2>
	{#if (interests.data ?? []).length === 0}
		<p>Follow topics from the feed to personalize what you see.</p>
	{:else}
		<ul class="interests">
			{#each interests.data ?? [] as i (i.slug)}
				<li>
					<span>{i.title}</span>
					<button
						type="button"
						class="ghost"
						onclick={() => deviceId && removeInterest({ deviceId, slug: i.slug })}>Remove</button
					>
				</li>
			{/each}
		</ul>
	{/if}
</section>
```

Add minimal styles for `.interests` (list reset, row flex space-between) in that file's `<style>`, matching the page's existing visual language.

- [ ] **Step 5: verify build + checks** — `bun run check` (0 errors); `bunx eslint src/lib/slug.ts src/lib/components/CardActions.svelte src/routes/+page.svelte src/routes/account/+page.svelte` (0); `bun run build` (succeeds); `bun run test:component` (existing pass). If a quick component test for CardActions' follow button is straightforward, add it; otherwise the browser test (controller-run) covers the UI.
- [ ] **Step 6: commit** — `git add src/ && git commit -m "feat(interests): follow-topic action + /account interests panel"`

---

## Post-implementation (controller)

Deploy (`npx convex dev --once`) + push; then browser-test like a human: open the deployed feed, Follow a topic from a card, confirm it appears in /account Interests and the toggle reflects state, then Remove it.

## Coverage boundary

Svelte component interactions are verified by the controller's browser test, not unit tests (matching the project's pattern); convex logic is unit/integration tested as above.
