# Connected-Wander Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Personalized wander feed — graded per-user dwell signal + connected-next threading + topic depth.

**Build order (value/risk):** graded-dwell (contained, sharpens learning) → connected-next (the wander, on the existing library) → depth (generation surgery, last). Each phase is independently shippable.

**Tech Stack:** Convex, SvelteKit/Svelte 5, Vitest + convex-test.

## Global Constraints
- Dwell is a SOFT signal: per-user normalized, clamped, complements (never replaces) explicit save/skip/not-interested. `visibleMs` is already stored on events.
- Threading/interest/dwell weights NUDGE; long-term taste (RELEVANCE_WEIGHT=10) dominates. Cold-start safe (absent signals → unchanged ranking; existing callers unaffected via optional params).
- Convex: `internal*` privacy, explicit `=== undefined`/`!== null`. After fn changes: `npx convex dev --once`. Tests: `bun run test:convex`/`test:component`. Before commit: `bun run check` + `bunx eslint <files>` (0).
- YAGNI: no connection-cards / graph store / link edges / surprise-dial here.

---

### Task 1: graded per-user dwell signal

**Files:** Modify `convex/profileLogic.ts`, `convex/profileLogic.test.ts`, `convex/profile.ts`.

- [ ] **Step 1: failing test** — append `convex/profileLogic.test.ts` (add `engagementWeight`, `meanCompleteDwell` to the `./profileLogic` import):
```ts
describe('engagementWeight (graded dwell)', () => {
	it('scales card_complete by dwell ratio vs user average, clamped', () => {
		const base = EVENT_DELTA.card_complete; // 1
		expect(engagementWeight('card_complete', 4000, 2000)).toBeCloseTo(base * 2); // 2x dwell
		expect(engagementWeight('card_complete', 20000, 2000)).toBeCloseTo(base * 2.5); // clamped hi
		expect(engagementWeight('card_complete', 200, 2000)).toBeCloseTo(base * 0.5); // clamped lo
		expect(engagementWeight('card_complete', undefined, 2000)).toBeCloseTo(base); // no ms → flat
		expect(engagementWeight('card_complete', 4000, 0)).toBeCloseTo(base); // no baseline → flat
	});
	it('leaves explicit + negative events flat', () => {
		expect(engagementWeight('save', 9999, 2000)).toBe(EVENT_DELTA.save);
		expect(engagementWeight('not_interested', 100, 2000)).toBe(EVENT_DELTA.not_interested);
		expect(engagementWeight('card_skip', 100, 2000)).toBe(EVENT_DELTA.card_skip);
	});
});
describe('meanCompleteDwell', () => {
	it('averages visibleMs over card_complete events only', () => {
		expect(meanCompleteDwell([
			{ type: 'card_complete', visibleMs: 1000 }, { type: 'card_complete', visibleMs: 3000 },
			{ type: 'card_skip', visibleMs: 100 }, { type: 'save' }
		])).toBe(2000);
		expect(meanCompleteDwell([{ type: 'save' }])).toBe(0); // none → 0 (callers treat 0 as "no baseline")
	});
});
```
Also append an `accumulateWeights` assertion that a high-dwell complete outweighs a low-dwell one (pass `userAvgDwell` + `visibleMs` on events).

- [ ] **Step 2: run → fail.**

- [ ] **Step 3a: `convex/profileLogic.ts`** — add the pure helpers + thread dwell through:
```ts
/** Graded engagement weight: card_complete scales by dwell vs the user's own
 * baseline (clamped); explicit/negative events keep their flat EVENT_DELTA. */
export function engagementWeight(type: string, visibleMs: number | undefined, userAvgDwell: number): number {
	const base = EVENT_DELTA[type];
	if (base === undefined) return 0;
	if (type !== 'card_complete' || visibleMs === undefined || userAvgDwell <= 0) return base;
	const ratio = Math.min(2.5, Math.max(0.5, visibleMs / userAvgDwell));
	return base * ratio;
}

/** Mean dwell (visibleMs) over a user's card_complete events; 0 when none. */
export function meanCompleteDwell(events: ReadonlyArray<{ type: string; visibleMs?: number }>): number {
	let sum = 0, n = 0;
	for (const e of events) {
		if (e.type === 'card_complete' && e.visibleMs !== undefined) { sum += e.visibleMs; n += 1; }
	}
	return n === 0 ? 0 : sum / n;
}
```
- Extend `WeightedEvent` to `{ type: string; cardId?: string | null; visibleMs?: number }`.
- `accumulateWeights(events, tagsByCard, userAvgDwell = 0)`: replace `const delta = EVENT_DELTA[e.type]; if (!delta) continue;` with `const delta = engagementWeight(e.type, e.visibleMs, userAvgDwell); if (delta === 0) continue;`.
- `buildTasteVector(events, embeddingByCard, now, userAvgDwell = 0)`: events type gains `visibleMs?`; replace `const delta = EVENT_DELTA[e.type]; if (delta === undefined || delta <= 0) continue;` with `const delta = engagementWeight(e.type, e.visibleMs, userAvgDwell); if (delta <= 0) continue;`.
- (Default `userAvgDwell = 0` keeps existing callers/tests behaving identically — 0 baseline → flat weights.)

- [ ] **Step 3b: `convex/profile.ts` recompute** — compute the baseline and pass it + visibleMs:
```ts
// after loading `events`:
		const userAvgDwell = meanCompleteDwell(events);
		const weights = accumulateWeights(events, tagsByCard, userAvgDwell);
// and where buildTasteVector is called, pass userAvgDwell as the 4th arg.
```
(Events from `ctx.db.query('events')` already carry `visibleMs`; ensure the objects passed include it — they're the raw docs, so `visibleMs` is present. Import `meanCompleteDwell`.)

- [ ] **Step 4: regenerate + tests + full suite + checks** — `npx convex dev --once`; `npx vitest run --project convex convex/profileLogic.test.ts` (PASS); `bun run test:convex` (green — existing profile tests still pass since default baseline=0 is flat); `bun run check` (0); `bunx eslint convex/profileLogic.ts convex/profile.ts` (0).
- [ ] **Step 5: commit** — `git add convex/profileLogic.ts convex/profileLogic.test.ts convex/profile.ts convex/_generated && git commit -m "feat(profile): graded per-user dwell weighting"`

---

### Task 2: connected-next — feed threading (backend)

**Files:** Modify `convex/profileLogic.ts`, `convex/profileLogic.test.ts`, `convex/feed.ts`, `convex/feed.test.ts`.

- [ ] **Step 1: failing tests** — append `convex/profileLogic.test.ts`:
```ts
import { THREAD_WEIGHT } from './profileLogic';
describe('scoreByTaste thread term', () => {
	it('adds THREAD_WEIGHT*cosine(threadEmbedding, card.embedding) when both present', () => {
		const card = { conceptTags: ['x'], embedding: [1, 0], slug: 's' };
		const ctx = { tasteVector: undefined, weights: {}, shuffleKey: 0, focusConcept: null };
		const near = scoreByTaste(card, { ...ctx, threadEmbedding: [1, 0] }); // cosine 1
		const none = scoreByTaste(card, { ...ctx });
		expect(near - none).toBeCloseTo(THREAD_WEIGHT);
	});
});
```
And `convex/feed.test.ts`: seed two published cards with distinct embeddings + shuffleKeys (so without threading the high-shuffle one wins); pass `threadFromCardId` = a card whose embedding matches the low-shuffle one; assert that low-shuffle card now ranks first.

- [ ] **Step 2: run → fail.**

- [ ] **Step 3a: `convex/profileLogic.ts`** — add `export const THREAD_WEIGHT = 4;` (nudge, below RELEVANCE_WEIGHT). In `scoreByTaste`, add `threadEmbedding?: number[]` to ctx and, after the interest boost, before `return`:
```ts
	if (ctx.threadEmbedding !== undefined && card.embedding !== undefined && card.embedding.length === ctx.threadEmbedding.length) {
		score += THREAD_WEIGHT * cosineSimilarity(ctx.threadEmbedding, card.embedding);
	}
```

- [ ] **Step 3b: `convex/feed.ts`** — add arg `threadFromCardId: v.optional(v.id('knowledgeCards'))`. After loading interests, load the thread card's embedding:
```ts
		let threadEmbedding: number[] | undefined;
		if (args.threadFromCardId !== undefined) {
			const tc = await ctx.db.get(args.threadFromCardId);
			threadEmbedding = tc?.embedding;
		}
```
Pass `threadEmbedding` into BOTH `scoreByTaste(...)` ctx objects (alongside tasteVector/weights/shuffleKey/focusConcept/interestSlugs).

- [ ] **Step 4: regenerate + tests + checks** — `npx convex dev --once`; `npx vitest run --project convex convex/profileLogic.test.ts convex/feed.test.ts` (PASS); `bun run test:convex` (green); `bun run check` (0); `bunx eslint convex/profileLogic.ts convex/feed.ts` (0).
- [ ] **Step 5: commit** — `git add convex/profileLogic.ts convex/profileLogic.test.ts convex/feed.ts convex/feed.test.ts convex/_generated && git commit -m "feat(feed): connected-next thread term (hop toward the card you just engaged)"`

---

### Task 3: connected-next — client wiring (the wander)

**Files:** Modify `src/routes/+page.svelte`.

- [ ] **Step 1: read first** — READ `src/routes/+page.svelte` around the `liveFeed = usePaginatedQuery(api.feed.unseen, ...)` getter, the `onComplete`/`completedThisSession` handling, and the `scheduleAdapt()` debounce (~1.5s). The thread id should update at a COARSE cadence (not every scroll tick) to avoid jarring re-sorts.

- [ ] **Step 2: implement** — add `let threadCardId = $state<Id<'knowledgeCards'> | null>(null);`. When a card COMPLETES (in the existing complete handler / `onComplete`), set it via the debounced path so it changes at most ~once/1.5s — e.g. assign `threadCardId` inside `scheduleAdapt`'s settled callback to the most-recent completed card. Pass it into the live feed getter:
```ts
	const liveFeed = usePaginatedQuery(
		api.feed.unseen,
		() => deviceId
			? { deviceId, focusConcept: focusConcept ?? undefined, threadFromCardId: threadCardId ?? undefined }
			: { deviceId: '', focusConcept: focusConcept ?? undefined },
		{ initialNumItems: 8 }
	);
```

- [ ] **Step 3: verify** — `bun run check` (0); `bunx eslint src/routes/+page.svelte` (0); `bun run build`; `bun run test:component` (existing pass).
- [ ] **Step 4: commit** — `git add src/routes/+page.svelte && git commit -m "feat(feed): thread the live feed from the card you just engaged"`

> Controller browser test after deploy: engage cards and confirm the next ones hop toward related ideas (a wander), without the feed feeling like it resets on every scroll. If re-sorting feels jarring, widen the update cadence (only on save, or every Nth completion).

---

### Task 4: depth — multiple facts per topic

**Files:** Modify `convex/generate.ts`, `convex/generationPipeline.ts`, `convex/topics.ts` (needingCards predicate), tests.

- [ ] **Step 1: read first** — READ `convex/generate.ts` `generateFromArticle` (the `generateObject` prompt + validate/dedup/insert), and `generationPipeline.ts` `generateForTopic`. Decide the smallest change that yields up to `TARGET_CARDS_PER_TOPIC` distinct facts per topic.

- [ ] **Step 2: implement (YAGNI)** —
  - `generationPipeline.ts`: `export const TARGET_CARDS_PER_TOPIC = 3;`. In `generateForTopic`, change the skip guard from `cardCount > 0` to `cardCount >= TARGET_CARDS_PER_TOPIC`; then loop `ingestAndGenerate`/`generateFromArticle` until the topic reaches TARGET cards or a small attempt cap, recording `setEvergreen`/`incrementCardCount` per published fact as today. Pass the topic's existing card hooks as `avoidHooks` so each pass surfaces a NEW angle (rely on the existing 0.88-cosine dedup to drop repeats).
  - `generate.ts`: add an optional `avoidHooks?: string[]` arg to `generateFromArticle`; include it in the prompt as "Surface a surprising fact DISTINCT from these already-covered angles: <hooks>". No other behavior change.
  - `topics.ts` `needingCards`: keep `cardCount === 0` (a fresh topic gets its full batch in one `generateForTopic` call) — OR widen if the read-first step shows a clean way to deepen partials; default to the simple version.
  - Decide one-call-array vs loop based on the read; the loop (reuse `generateFromArticle`) is the YAGNI default. If a clean batch-array refactor is obvious and cheaper, that's acceptable — note it.

- [ ] **Step 3: tests** — pure: `avoidHooks` is threaded into the prompt string (if extractable) — else assert via the changed signature. `convex-test`: `generateForTopic` skips when `cardCount >= TARGET` (seed a topic at TARGET → status 'skipped', no new work). The live generation loop is the coverage boundary (network/AI), validated post-deploy.

- [ ] **Step 4: regenerate + full suite + checks** — `npx convex dev --once`; `npx vitest run --project convex convex/generationPipeline.test.ts` (PASS); `bun run test:convex` (green); `bun run check` (0); `bunx eslint convex/generate.ts convex/generationPipeline.ts convex/topics.ts` (0).
- [ ] **Step 5: commit** — `git add convex/generate.ts convex/generationPipeline.ts convex/topics.ts convex/*.test.ts convex/_generated && git commit -m "feat(generation): depth — up to N distinct facts per topic"`

---

## Post-implementation (controller)
Deploy + push. Browser-test the wander (Task 3 note). Trigger a generation pass (`generationPipeline:run`) and confirm a topic now yields multiple distinct cards. Then it ships and we tune the weights (dwell clamp, THREAD_WEIGHT, TARGET) on real engagement.

## Coverage boundary
Pure scoring/weighting logic + DB-only behavior are unit/convex-tested; the live AI generation loop + the feel of the wander are validated by the post-deploy run + browser test (project precedent).
