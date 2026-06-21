# AI-Backed Feed Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank the unseen feed by a per-user taste vector (cosine similarity to liked cards' embeddings) blended with novelty, falling back to today's concept-affinity at cold-start.

**Architecture:** A pure `buildTasteVector` (weighted, recency-favored average of positively-engaged cards' embeddings) is computed in `profile.recompute` and stored on `userProfiles.tasteVector`. A pure `scoreByTaste` ranks `feed.unseen`'s candidate page by `RELEVANCE_WEIGHT·cosine(taste, card.embedding) + novelty + focus`, falling back to `scoreCard` when taste or a card embedding is missing. Reuses `embedLogic.cosineSimilarity`; no new infrastructure.

**Tech Stack:** Convex (queries/mutations, pagination, vector field), Vitest (convex/server projects), bun.

## Global Constraints

- Taste = POSITIVE engagement only (`EVENT_DELTA[type] > 0`: save 3, related_tap/card_expand 2, source_open 1.5, card_complete 1), recency-favored. Skip/not_interested do NOT shape taste.
- Ranking is a swappable PURE step in `profileLogic` (no Convex/network), unit-testable.
- Graceful fallback: no taste vector OR a candidate without an embedding → `scoreCard` (today's behavior). Never worse than current.
- Discovery slice preserved via the retained `WILDCARD_WEIGHT · shuffleKey` term. No forced off-taste injector (out of scope).
- The feed must still NEVER return a seen / not-interested card (don't regress `feed.unseen`'s exclusion).
- Embedding dimension is 1536 (`openai/text-embedding-3-small`); guard against dimension mismatch (return/fall back, never throw in the feed path).
- **Deployment:** live site uses the Convex DEV deployment `adept-spoonbill-177`; backend reaches it via `npx convex dev --once` (NOT `convex deploy`). Frontend via push to `main` (Vercel). Admin/migration via `npx convex run` WITHOUT `--prod`.
- Package manager **bun**. Verify with `bun run check`, `bunx vitest run convex/<file>`, `bunx eslint convex/`, `bunx prettier --check <files>`. Do NOT run `bun run lint` (vendored-file prettier failures).

---

### Task 1: `buildTasteVector` pure helper + constants

**Files:**
- Modify: `convex/profileLogic.ts` (add constants + `buildTasteVector`)
- Test: `convex/profileLogic.test.ts`

**Interfaces:**
- Consumes: existing `EVENT_DELTA` (in `profileLogic.ts`).
- Produces: `buildTasteVector(events, embeddingByCard, now) => number[] | undefined` and `export const TASTE_HALFLIFE_MS`.

- [ ] **Step 1: Write the failing tests**

Add to `convex/profileLogic.test.ts`:

```ts
import { buildTasteVector, TASTE_HALFLIFE_MS } from './profileLogic';

describe('buildTasteVector', () => {
	const NOW = 1_000_000_000_000;
	it('returns undefined when no positive event has an embedding', () => {
		const events = [{ type: 'card_skip', cardId: 'a', ts: NOW }];
		expect(buildTasteVector(events, { a: [1, 0] }, NOW)).toBeUndefined();
		// positive event but no embedding for the card:
		expect(buildTasteVector([{ type: 'save', cardId: 'b', ts: NOW }], {}, NOW)).toBeUndefined();
	});

	it('averages positively-engaged embeddings weighted by EVENT_DELTA', () => {
		// save (delta 3) of [1,0] and complete (delta 1) of [0,1], same time → (3·[1,0]+1·[0,1])/4
		const events = [
			{ type: 'save', cardId: 'a', ts: NOW },
			{ type: 'card_complete', cardId: 'b', ts: NOW }
		];
		const v = buildTasteVector(events, { a: [1, 0], b: [0, 1] }, NOW)!;
		expect(v[0]).toBeCloseTo(0.75);
		expect(v[1]).toBeCloseTo(0.25);
	});

	it('ignores skip / not_interested when shaping taste', () => {
		const events = [
			{ type: 'save', cardId: 'a', ts: NOW },
			{ type: 'not_interested', cardId: 'b', ts: NOW },
			{ type: 'card_skip', cardId: 'c', ts: NOW }
		];
		const v = buildTasteVector(events, { a: [1, 0], b: [0, 1], c: [0, 1] }, NOW)!;
		expect(v[0]).toBeCloseTo(1); // only 'a' contributed
		expect(v[1]).toBeCloseTo(0);
	});

	it('weights recent engagement more (recency half-life)', () => {
		const old = NOW - TASTE_HALFLIFE_MS; // one half-life ago → weight halved
		const events = [
			{ type: 'save', cardId: 'a', ts: NOW }, // [1,0] weight 3·1
			{ type: 'save', cardId: 'b', ts: old } //  [0,1] weight 3·0.5
		];
		const v = buildTasteVector(events, { a: [1, 0], b: [0, 1] }, NOW)!;
		expect(v[0]).toBeGreaterThan(v[1]); // recent 'a' dominates
	});
});
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `bunx vitest run convex/profileLogic.test.ts`
Expected: FAIL (`buildTasteVector` not exported).

- [ ] **Step 3: Implement**

In `convex/profileLogic.ts` add (after the existing constants):

```ts
/** Half-life for recency weighting of taste signals (14 days). */
export const TASTE_HALFLIFE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Per-user taste vector: a recency-favored, EVENT_DELTA-weighted average of the
 * embeddings of POSITIVELY-engaged cards. Negatives (skip/not_interested) are
 * ignored — they only exclude cards elsewhere. Returns undefined when no
 * positive event has an embedding (cold-start). Pure → unit-testable.
 */
export function buildTasteVector(
	events: ReadonlyArray<{ type: string; cardId?: string | null; ts: number }>,
	embeddingByCard: Record<string, number[] | undefined>,
	now: number
): number[] | undefined {
	let acc: number[] | null = null;
	let totalWeight = 0;
	for (const e of events) {
		if (e.cardId === undefined || e.cardId === null) continue;
		const delta = EVENT_DELTA[e.type];
		if (delta === undefined || delta <= 0) continue; // positives only
		const emb = embeddingByCard[e.cardId];
		if (emb === undefined) continue;
		const recency = Math.pow(0.5, Math.max(0, now - e.ts) / TASTE_HALFLIFE_MS);
		const w = delta * recency;
		if (w <= 0) continue;
		if (acc === null) acc = new Array<number>(emb.length).fill(0);
		if (emb.length !== acc.length) continue; // dimension guard
		for (let i = 0; i < acc.length; i++) acc[i] += w * emb[i];
		totalWeight += w;
	}
	if (acc === null || totalWeight === 0) return undefined;
	return acc.map((x) => x / totalWeight);
}
```

- [ ] **Step 4: Run them — expect PASS**

Run: `bunx vitest run convex/profileLogic.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/profileLogic.ts convex/profileLogic.test.ts
git commit -m "feat: buildTasteVector — recency-weighted taste embedding"
```

---

### Task 2: Store `tasteVector` on the profile (schema + recompute)

**Files:**
- Modify: `convex/schema.ts` (add `userProfiles.tasteVector`)
- Modify: `convex/profile.ts` (`recompute` builds + stores it)
- Test: `convex/profile` coverage — add to an existing convex test file or create `convex/profile.test.ts`

**Interfaces:**
- Consumes: `buildTasteVector` (Task 1).
- Produces: `userProfiles.tasteVector?: number[]`; `recompute` writes it (or omits at cold-start).

- [ ] **Step 1: Write the failing test**

Create `convex/profile.test.ts`:

```ts
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('recompute stores a tasteVector from positively-engaged embedded cards', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'taste-dev';
	const cardId = await t.run(async (ctx) =>
		ctx.db.insert('knowledgeCards', {
			hook: 'h', body: 'a'.repeat(100), format: 'object_story', conceptTags: ['t'],
			source: { articleTitle: 'T', articleUrl: 'u', revisionId: null, sourceSpan: 's' },
			status: 'published', shuffleKey: 0.5, createdAt: 0,
			embedding: Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0))
		})
	);
	await t.mutation(api.events.log, {
		deviceId, sessionId: 's', events: [{ type: 'save', cardId, ts: 1 }]
	});
	await t.mutation(api.profile.recompute, { deviceId });
	const profile = await t.run(async (ctx) =>
		ctx.db.query('userProfiles').withIndex('by_device', (q) => q.eq('deviceId', deviceId)).unique()
	);
	expect(profile?.tasteVector).toBeDefined();
	expect(profile?.tasteVector?.length).toBe(1536);
});

test('recompute omits tasteVector at cold-start (no embedded positive engagement)', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'cold-dev';
	await t.mutation(api.profile.recompute, { deviceId });
	const profile = await t.run(async (ctx) =>
		ctx.db.query('userProfiles').withIndex('by_device', (q) => q.eq('deviceId', deviceId)).unique()
	);
	expect(profile?.tasteVector).toBeUndefined();
});
```

NOTE: match the `knowledgeCards`/`sourceValidator` shape to `convex/schema.ts` exactly (the `source` literal above mirrors the shape used elsewhere; adjust if the schema differs).

- [ ] **Step 2: Run it — expect FAIL**

Run: `bunx vitest run convex/profile.test.ts`
Expected: FAIL (schema rejects `tasteVector` / it isn't written).

- [ ] **Step 3: Add the schema field**

In `convex/schema.ts`, in `userProfiles`, add after `notInterested`:

```ts
		// Embedding of the user's taste (avg of liked cards), for AI feed ranking.
		// Optional: only set once they positively engage with embedded cards.
		tasteVector: v.optional(v.array(v.float64())),
```

- [ ] **Step 4: Build + store it in `recompute`**

In `convex/profile.ts`: import `buildTasteVector` (`import { accumulateWeights, buildTasteVector } from './profileLogic';`). The handler already fetches `cards`; build an embedding map and call the helper, then store conditionally. Replace the profile-write section:

```ts
		const tagsByCard: Record<string, string[]> = {};
		const embeddingByCard: Record<string, number[] | undefined> = {};
		for (const card of cards) {
			if (card) {
				tagsByCard[card._id] = card.conceptTags;
				embeddingByCard[card._id] = card.embedding;
			}
		}

		const weights = accumulateWeights(events, tagsByCard);
		const notInterested = new Set<Id<'knowledgeCards'>>();
		for (const e of events) {
			if (e.cardId === undefined || e.cardId === null) continue;
			if (e.type === 'not_interested') notInterested.add(e.cardId);
		}
		const tasteVector = buildTasteVector(events, embeddingByCard, Date.now());

		const profile = {
			deviceId: args.deviceId,
			conceptWeights: Object.entries(weights).map(([concept, weight]) => ({ concept, weight })),
			notInterested: [...notInterested],
			updatedAt: Date.now()
		};

		const existing = await ctx.db
			.query('userProfiles')
			.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
			.unique();
		if (existing) {
			// patch with tasteVector set-or-cleared (Convex removes a field set to undefined).
			await ctx.db.patch(existing._id, { ...profile, tasteVector });
		} else {
			await ctx.db.insert(
				'userProfiles',
				tasteVector !== undefined ? { ...profile, tasteVector } : profile
			);
		}
```

(Keep the existing `return { concepts, notInterested }`.)

- [ ] **Step 5: Run it — expect PASS**

Run: `bunx convex codegen` then `bunx vitest run convex/profile.test.ts` → PASS. `bun run check` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/profile.ts convex/profile.test.ts
git commit -m "feat: store per-user tasteVector in recompute"
```

---

### Task 3: `scoreByTaste` pure ranker

**Files:**
- Modify: `convex/profileLogic.ts` (add `RELEVANCE_WEIGHT` + `scoreByTaste`)
- Test: `convex/profileLogic.test.ts`

**Interfaces:**
- Consumes: `cosineSimilarity` (from `./embedLogic`), existing `scoreCard`, `WILDCARD_WEIGHT`, `FOCUS_BOOST`.
- Produces: `scoreByTaste(card, ctx) => number` where `card = { conceptTags: string[]; embedding?: number[] }`, `ctx = { tasteVector?: number[]; weights: Record<string, number>; shuffleKey: number; focusConcept?: string | null }`.

- [ ] **Step 1: Write the failing tests**

Add to `convex/profileLogic.test.ts`:

```ts
import { scoreByTaste } from './profileLogic';

describe('scoreByTaste', () => {
	const taste = [1, 0];
	it('ranks an on-taste card above an off-taste card', () => {
		const near = scoreByTaste(
			{ conceptTags: [], embedding: [1, 0] },
			{ tasteVector: taste, weights: {}, shuffleKey: 0 }
		);
		const far = scoreByTaste(
			{ conceptTags: [], embedding: [0, 1] },
			{ tasteVector: taste, weights: {}, shuffleKey: 0 }
		);
		expect(near).toBeGreaterThan(far);
	});

	it('falls back to scoreCard when there is no taste vector', () => {
		const liked = scoreByTaste(
			{ conceptTags: ['x'], embedding: [1, 0] },
			{ tasteVector: undefined, weights: { x: 5 }, shuffleKey: 0 }
		);
		const neutral = scoreByTaste(
			{ conceptTags: ['y'], embedding: [1, 0] },
			{ tasteVector: undefined, weights: { x: 5 }, shuffleKey: 0 }
		);
		expect(liked).toBeGreaterThan(neutral); // concept-affinity, not embedding
	});

	it('falls back to scoreCard when the card has no embedding', () => {
		const score = scoreByTaste(
			{ conceptTags: ['x'] },
			{ tasteVector: taste, weights: { x: 5 }, shuffleKey: 0 }
		);
		// equals the concept-affinity score (5) — no embedding term applied
		expect(score).toBeCloseTo(5);
	});
});
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `bunx vitest run convex/profileLogic.test.ts` → FAIL (`scoreByTaste` not exported).

- [ ] **Step 3: Implement**

At the top of `convex/profileLogic.ts` add the import:

```ts
import { cosineSimilarity } from './embedLogic';
```

Add the constant near the others:

```ts
/** How hard taste-similarity (cosine ≈0–1) drives ranking vs the novelty term.
 * High enough that relevance dominates while WILDCARD_WEIGHT still reshuffles
 * near-ties (the discovery slice). */
export const RELEVANCE_WEIGHT = 10;
```

Add the function:

```ts
/**
 * Taste-aware score: when a taste vector and the card's embedding are both
 * present, rank by cosine similarity + novelty + focus. Otherwise fall back to
 * concept-affinity (scoreCard) — cold-start and un-embedded cards rank sanely.
 */
export function scoreByTaste(
	card: { conceptTags: string[]; embedding?: number[] },
	ctx: {
		tasteVector?: number[];
		weights: Record<string, number>;
		shuffleKey: number;
		focusConcept?: string | null;
	}
): number {
	const emb = card.embedding;
	if (ctx.tasteVector !== undefined && emb !== undefined && emb.length === ctx.tasteVector.length) {
		let score = RELEVANCE_WEIGHT * cosineSimilarity(ctx.tasteVector, emb);
		score += WILDCARD_WEIGHT * ctx.shuffleKey;
		if (ctx.focusConcept && card.conceptTags.includes(ctx.focusConcept)) score += FOCUS_BOOST;
		return score;
	}
	return scoreCard(card.conceptTags, ctx.weights, {
		shuffleKey: ctx.shuffleKey,
		focusConcept: ctx.focusConcept
	});
}
```

(The `ctx.focusConcept && …` form mirrors the existing `scoreCard`.)

- [ ] **Step 4: Run them — expect PASS**

Run: `bunx vitest run convex/profileLogic.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/profileLogic.ts convex/profileLogic.test.ts
git commit -m "feat: scoreByTaste — cosine+novelty ranker with concept-affinity fallback"
```

---

### Task 4: Rank `feed.unseen` by taste

**Files:**
- Modify: `convex/feed.ts` (use `scoreByTaste` + `profile.tasteVector`)
- Test: `convex/feed.test.ts`

**Interfaces:**
- Consumes: `scoreByTaste` (Task 3), `userProfiles.tasteVector` (Task 2).

- [ ] **Step 1: Write the failing test**

Add to `convex/feed.test.ts`:

```ts
test('feed.unseen ranks an on-taste card ahead of an off-taste one', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'rank-dev';
	const near = await t.run(async (ctx) =>
		ctx.db.insert('knowledgeCards', {
			hook: 'near', body: 'a'.repeat(100), format: 'object_story', conceptTags: ['t'],
			source: { articleTitle: 'T', articleUrl: 'u', revisionId: null, sourceSpan: 's' },
			status: 'published', shuffleKey: 0.1, createdAt: 0,
			embedding: Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0))
		})
	);
	const far = await t.run(async (ctx) =>
		ctx.db.insert('knowledgeCards', {
			hook: 'far', body: 'a'.repeat(100), format: 'object_story', conceptTags: ['t'],
			source: { articleTitle: 'T', articleUrl: 'u', revisionId: null, sourceSpan: 's' },
			status: 'published', shuffleKey: 0.9, createdAt: 0,
			embedding: Array(1536).fill(0).map((_, i) => (i === 1 ? 1 : 0))
		})
	);
	// taste = the 'near' embedding direction
	await t.run(async (ctx) =>
		ctx.db.insert('userProfiles', {
			deviceId, conceptWeights: [], notInterested: [], updatedAt: 0,
			tasteVector: Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0))
		})
	);
	const res = await t.query(api.feed.unseen, {
		deviceId, paginationOpts: { numItems: 50, cursor: null }
	});
	const ids = res.page.map((c) => c._id);
	expect(ids.indexOf(near)).toBeLessThan(ids.indexOf(far)); // on-taste first despite higher far shuffleKey
});
```

(Match the `knowledgeCards` literal to schema exactly.)

- [ ] **Step 2: Run it — expect FAIL**

Run: `bunx vitest run convex/feed.test.ts`
Expected: FAIL — current ranking uses `scoreCard` (ignores embedding), so the higher-`shuffleKey` `far` card sorts first.

- [ ] **Step 3: Switch the ranker**

In `convex/feed.ts`: change the import `import { scoreCard } from './profileLogic';` to `import { scoreByTaste } from './profileLogic';`. Read the taste vector and rank with it. Replace the sort block:

```ts
		const tasteVector = profile?.tasteVector;
		unseenCards.sort(
			(a, b) =>
				scoreByTaste(b, {
					tasteVector,
					weights,
					shuffleKey: b.shuffleKey,
					focusConcept: args.focusConcept
				}) -
				scoreByTaste(a, {
					tasteVector,
					weights,
					shuffleKey: a.shuffleKey,
					focusConcept: args.focusConcept
				})
		);
```

Update the file's top doc comment to say ranking is taste-aware (cosine + novelty) with concept-affinity fallback.

- [ ] **Step 4: Run tests — expect PASS**

Run: `bunx vitest run convex/feed.test.ts` → PASS (including the existing never-repeat + anonymous + focus tests). `bunx convex codegen` + `bun run check` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add convex/feed.ts convex/feed.test.ts
git commit -m "feat: rank unseen feed by taste vector (cosine), concept-affinity fallback"
```

---

### Task 5: Verify, deploy to live deployment, confirm

**Files:** none (release task).

- [ ] **Step 1: Full verification**

Run: `bun run check` (0 errors); `bun run test:unit`; `bun run test:convex`; `bun run test:component` — all pass. `bunx eslint convex/ src/`.

- [ ] **Step 2: Deploy backend to the live deployment**

```bash
bunx convex dev --once   # pushes to the LIVE dev deployment (adept-spoonbill-177)
```
(No frontend change in this feature; nothing to push for Vercel. If `bun run check`/codegen changed `convex/_generated`, commit it and `git push origin main`.)

- [ ] **Step 3: Recompute profiles so taste vectors populate**

Taste vectors are built on `recompute` (runs on session start). To populate immediately for existing devices, recompute is per-device; the live site re-runs it on next visit. Optionally spot-check one device:
```bash
npx convex run profile:recompute '{"deviceId":"<deviceId>"}'
```
then confirm its profile has a `tasteVector` via `npx convex run feed:unseen '{"deviceId":"<id>","paginationOpts":{"numItems":5,"cursor":null}}'` (no `--prod`).

- [ ] **Step 4: Confirm on the live site**

On `https://brain-rot-pro.vercel.app`: with a device that has engaged (saved/completed some cards), confirm the feed still loads, never repeats, and leans toward that device's liked topics. A cold device should still get the (concept-affinity) feed unchanged.

- [ ] **Step 5: Final commit (if any tweaks / generated files)**

```bash
git add -A && git commit -m "chore: ai-feed-ranking verification tweaks" && git push origin main
```

---

## Self-Review

- **Spec coverage:** taste vector (positive, recency, EVENT_DELTA) → T1; stored on profile via recompute, cold-start omit → T2; `scoreByTaste` blend + fallback → T3; `feed.unseen` ranks by taste → T4; deploy/confirm (correct deployment) → T5. ✓
- **Constants:** `RELEVANCE_WEIGHT=10`, `TASTE_HALFLIFE_MS=14d` — defined as named constants (tunable), not magic literals.
- **Type consistency:** `buildTasteVector(events, embeddingByCard, now) → number[] | undefined` defined T1, consumed T2. `scoreByTaste(card{conceptTags,embedding?}, ctx{tasteVector?,weights,shuffleKey,focusConcept?}) → number` defined T3, consumed T4. `userProfiles.tasteVector?: number[]` defined T2, read T4.
- **Fallback / safety:** dimension-mismatch + missing-embedding + no-taste all fall back to `scoreCard`; never throws in the feed path. Never-repeat exclusion in `feed.unseen` is untouched (T4 only swaps the ranker, not the filter) and the existing feed tests must still pass.
- **Placeholders:** none; every code step has concrete code. Schema-literal caveats call out matching `schema.ts` exactly.
- **Deployment:** T5 uses `convex dev --once` + `convex run` (no `--prod`).
