# Infinite Unseen Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user never sees the same card twice and can consume thousands/day, served from a shared growing library via an efficient unseen-only feed.

**Architecture:** A durable `seenCards` table (one row per device×card) becomes the source of truth for "seen." The feed paginates published cards and hard-excludes seen + not-interested, then ranks the surviving page with a swappable light ranker (AI-ready seam). Existing `userProfiles.seen` is migrated widen→migrate→narrow. A "running low" trigger plus faster generation keeps the shared pool ahead.

**Tech Stack:** Convex (queries/mutations/actions, pagination, indexes), Svelte 5 + convex-svelte, Vitest (convex/server/client projects), bun.

## Global Constraints

- A user must NEVER see the same card twice (durable, forever, per device).
- The feed must never `collect()` all published cards — always paginate.
- Seen is the EXCLUSION mechanism (hard filter), not a score penalty.
- Personalization stays a separate `rankPage`/`scoreCard` step (swappable for AI later).
- **Deployment:** the live site reads the Convex **dev** deployment `adept-spoonbill-177`. Backend code reaches it via `npx convex dev --once` (NOT `convex deploy`, which targets the unused prod deployment). Admin/migration via `npx convex run <fn>` WITHOUT `--prod`. Frontend deploys by pushing `main` (Vercel auto-deploy).
- Package manager: **bun**. Verify with `bun run check`, `bunx vitest run convex/<file>`, `bunx eslint convex/ src/`, `bunx prettier --check <files>`. Do NOT run `bun run lint` (it prettier-checks vendored files).

---

### Task 1: Add `seenCards` table + dual-write on event log

**Files:**
- Modify: `convex/schema.ts` (add `seenCards` table; make `userProfiles.seen` optional)
- Modify: `convex/events.ts` (upsert seenCards for seen-type events)
- Test: `convex/events.test.ts`

**Interfaces:**
- Produces: table `seenCards { deviceId: string, cardId: Id<'knowledgeCards'>, seenAt: number }` with indexes `by_device_card` `['deviceId','cardId']` and `by_device` `['deviceId']`. Seen-type events (`card_impression`, `card_complete`, `card_skip`) with a `cardId` create exactly one `seenCards` row per (device, card).

- [ ] **Step 1: Write the failing test**

Add to `convex/events.test.ts`:

```ts
test('events.log records seenCards for seen-type events, idempotently', async () => {
	const t = convexTest(schema, modules);
	const cardId = await firstCardId(t);
	const deviceId = 'seen-device';
	await t.mutation(api.events.log, {
		deviceId,
		sessionId: 's1',
		events: [
			{ type: 'card_impression', cardId, ts: 1 },
			{ type: 'card_complete', cardId, ts: 2 } // same card again
		]
	});
	const rows = await t.run(async (ctx) =>
		ctx.db
			.query('seenCards')
			.withIndex('by_device', (q) => q.eq('deviceId', deviceId))
			.collect()
	);
	expect(rows).toHaveLength(1); // one row per (device, card), not per event
	expect(rows[0].cardId).toBe(cardId);
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `bunx vitest run convex/events.test.ts`
Expected: FAIL — `seenCards` table doesn't exist / no rows written.

- [ ] **Step 3: Add the schema table + make seen optional**

In `convex/schema.ts`, add a new table (next to `userProfiles`):

```ts
	// Durable "seen" — one row per (device, card). Source of truth for the
	// never-repeat guarantee; replaces the unbounded userProfiles.seen array.
	seenCards: defineTable({
		deviceId: v.string(),
		cardId: v.id('knowledgeCards'),
		seenAt: v.number()
	})
		.index('by_device_card', ['deviceId', 'cardId'])
		.index('by_device', ['deviceId']),
```

In the same file, change `userProfiles.seen` to optional (widen step, so later narrowing validates):

```ts
		seen: v.optional(v.array(v.id('knowledgeCards'))),
```

- [ ] **Step 4: Upsert seenCards in `events.log`**

In `convex/events.ts`, replace the handler body's write section. After the existing `await Promise.all(... insert('events') ...)`, add seen upserts:

```ts
		// Record seen (durable, idempotent) for the never-repeat guarantee.
		const SEEN_TYPES = new Set(['card_impression', 'card_complete', 'card_skip']);
		const seenCardIds = [
			...new Set(
				args.events.filter((e) => SEEN_TYPES.has(e.type) && e.cardId).map((e) => e.cardId!)
			)
		];
		await Promise.all(
			seenCardIds.map(async (cardId) => {
				const existing = await ctx.db
					.query('seenCards')
					.withIndex('by_device_card', (q) =>
						q.eq('deviceId', args.deviceId).eq('cardId', cardId)
					)
					.unique();
				if (!existing) {
					await ctx.db.insert('seenCards', { deviceId: args.deviceId, cardId, seenAt: e_ts(args, cardId) });
				}
			})
		);
```

Add a small helper above the export (seenAt = the event's ts, fall back to the max ts in the batch):

```ts
function e_ts(args: { events: { cardId?: unknown; ts: number }[] }, cardId: unknown): number {
	const hit = args.events.find((e) => e.cardId === cardId);
	return hit?.ts ?? 0;
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `bunx vitest run convex/events.test.ts` → PASS. Then `bunx convex codegen` and `bun run check` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/events.ts convex/events.test.ts
git commit -m "feat: durable seenCards table + dual-write on event log"
```

---

### Task 2: Purge `seenCards` on account deletion

**Files:**
- Modify: `convex/account.ts` (delete seenCards in `deleteData` + its batch helper)
- Test: `convex/account.test.ts`

**Interfaces:**
- Consumes: `seenCards.by_device` (Task 1).
- Produces: `account.deleteData` removes all `seenCards` rows for the device.

- [ ] **Step 1: Extend the deletion test**

In `convex/account.test.ts`, in the `deleteData erases every trace` test, add a seen row before deletion and assert it's gone. After the existing `events.log` call, the impression already creates a seenCards row (Task 1). In the `leftovers` `t.run`, add:

```ts
		const seen = await ctx.db
			.query('seenCards')
			.withIndex('by_device', (q) => q.eq('deviceId', deviceId))
			.collect();
		return { events: events.length, codes: codes.length, profile: profile === null, seen: seen.length };
	});
	expect(leftovers).toEqual({ events: 0, codes: 0, profile: true, seen: 0 });
```

- [ ] **Step 2: Run it — expect FAIL** (`seen` leftover > 0)

Run: `bunx vitest run convex/account.test.ts` → FAIL.

- [ ] **Step 3: Delete seenCards in `deleteData`**

In `convex/account.ts`, add a batched purge mirroring `purgeEvents`. Add near `purgeEvents`:

```ts
async function purgeSeen(ctx: MutationCtx, deviceId: string): Promise<void> {
	const batch = await ctx.db
		.query('seenCards')
		.withIndex('by_device', (q) => q.eq('deviceId', deviceId))
		.take(500);
	await Promise.all(batch.map((s) => ctx.db.delete(s._id)));
	if (batch.length === 500) {
		await ctx.scheduler.runAfter(0, internal.account.purgeSeenBatch, { deviceId });
	}
}

export const purgeSeenBatch = internalMutation({
	args: { deviceId: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		await purgeSeen(ctx, args.deviceId);
		return null;
	}
});
```

And in `deleteData`'s handler, after `await purgeEvents(...)`, add `await purgeSeen(ctx, args.deviceId);`.

- [ ] **Step 4: Run tests — expect PASS**

Run: `bunx vitest run convex/account.test.ts` → PASS. `bunx convex codegen` + `bun run check` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add convex/account.ts convex/account.test.ts
git commit -m "feat: purge seenCards on account deletion"
```

---

### Task 3: Migration backfill `userProfiles.seen[]` → `seenCards`

**Files:**
- Create: `convex/seenMigration.ts`
- Test: `convex/seenMigration.test.ts`

**Interfaces:**
- Consumes: `userProfiles.by_device`, `seenCards.by_device_card`.
- Produces: `internal.seenMigration.backfillSeen({ limit })` → `{ profilesScanned, rowsInserted }`. Idempotent (skips existing seenCards rows).

- [ ] **Step 1: Write the failing test**

Create `convex/seenMigration.test.ts`:

```ts
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('backfillSeen copies userProfiles.seen into seenCards, idempotently', async () => {
	const t = convexTest(schema, modules);
	const cardId = await t.run(async (ctx) =>
		ctx.db.insert('knowledgeCards', {
			hook: 'h', body: 'a'.repeat(100), format: 'object_story', conceptTags: ['t'],
			source: { articleTitle: 'T', articleUrl: 'u', sourceSpan: 's' },
			status: 'published', shuffleKey: 0.5, createdAt: 0
		})
	);
	await t.run(async (ctx) =>
		ctx.db.insert('userProfiles', {
			deviceId: 'd1', conceptWeights: [], seen: [cardId], notInterested: [], updatedAt: 0
		})
	);

	const r1 = await t.mutation(internal.seenMigration.backfillSeen, { limit: 100 });
	expect(r1.rowsInserted).toBe(1);
	const r2 = await t.mutation(internal.seenMigration.backfillSeen, { limit: 100 });
	expect(r2.rowsInserted).toBe(0); // idempotent

	const rows = await t.run(async (ctx) =>
		ctx.db.query('seenCards').withIndex('by_device', (q) => q.eq('deviceId', 'd1')).collect()
	);
	expect(rows).toHaveLength(1);
	expect(rows[0].cardId).toBe(cardId);
});
```

NOTE: match the `knowledgeCards`/`sourceValidator` shape to `convex/schema.ts` exactly (add fields if required).

- [ ] **Step 2: Run it — expect FAIL** (`internal.seenMigration.backfillSeen` missing)

Run: `bunx vitest run convex/seenMigration.test.ts` → FAIL.

- [ ] **Step 3: Implement the backfill**

Create `convex/seenMigration.ts`:

```ts
import { internalMutation } from './_generated/server';
import { v } from 'convex/values';

/** One-time: copy each userProfiles.seen[] into seenCards rows. Idempotent —
 * skips (device, card) pairs that already exist. Run repeatedly until
 * profilesScanned is 0 (paginate via limit). */
export const backfillSeen = internalMutation({
	args: { limit: v.number() },
	returns: v.object({ profilesScanned: v.number(), rowsInserted: v.number() }),
	handler: async (ctx, { limit }) => {
		const profiles = await ctx.db.query('userProfiles').take(limit);
		let rowsInserted = 0;
		for (const p of profiles) {
			for (const cardId of p.seen ?? []) {
				const existing = await ctx.db
					.query('seenCards')
					.withIndex('by_device_card', (q) => q.eq('deviceId', p.deviceId).eq('cardId', cardId))
					.unique();
				if (!existing) {
					await ctx.db.insert('seenCards', { deviceId: p.deviceId, cardId, seenAt: p.updatedAt });
					rowsInserted++;
				}
			}
		}
		return { profilesScanned: profiles.length, rowsInserted };
	}
});
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `bunx vitest run convex/seenMigration.test.ts` → PASS. `bunx convex codegen` + `bun run check`.

- [ ] **Step 5: Commit**

```bash
git add convex/seenMigration.ts convex/seenMigration.test.ts
git commit -m "feat: migration backfill userProfiles.seen -> seenCards"
```

---

### Task 4: Unseen feed query (paginate + exclude) + remove SEEN_PENALTY

**Files:**
- Modify: `convex/profileLogic.ts` (drop `SEEN_PENALTY` from `scoreCard`)
- Modify: `convex/profileLogic.test.ts` (update scoreCard tests)
- Modify: `convex/feed.ts` (replace `personal` with paginated `unseen`)
- Test: `convex/feed.test.ts`

**Interfaces:**
- Consumes: `seenCards.by_device_card`, `userProfiles.by_device`, `knowledgeCards.by_status_shuffle`.
- Produces: `api.feed.unseen({ deviceId, paginationOpts, focusConcept? })` → a Convex paginated result whose `page` contains only cards NOT in `seenCards` and NOT in `notInterested`, ranked by `scoreCard`. `scoreCard` no longer takes/uses `seen`.

- [ ] **Step 1: Update scoreCard tests (failing)**

In `convex/profileLogic.test.ts`, change any `scoreCard(..., { seen: true/false, ... })` calls to drop the `seen` option, and remove assertions about the seen penalty. Add/keep a test that affinity + focus boost still order correctly. (If no scoreCard test exists, add one asserting a higher-affinity card scores above a lower one and a focusConcept match scores highest.)

- [ ] **Step 2: Run it — expect FAIL** (type error: `seen` missing / penalty assertion)

Run: `bunx vitest run convex/profileLogic.test.ts` → FAIL.

- [ ] **Step 3: Remove SEEN_PENALTY**

In `convex/profileLogic.ts`: delete the `SEEN_PENALTY` const and its doc comment, and change `scoreCard`:

```ts
export function scoreCard(
	tags: string[],
	weights: Record<string, number>,
	opts: { shuffleKey: number; focusConcept?: string | null }
): number {
	let score = 0;
	for (const tag of tags) score += weights[tag] ?? 0;
	score += WILDCARD_WEIGHT * opts.shuffleKey;
	if (opts.focusConcept && tags.includes(opts.focusConcept)) score += FOCUS_BOOST;
	return score;
}
```

- [ ] **Step 4: Run scoreCard tests — expect PASS**

Run: `bunx vitest run convex/profileLogic.test.ts` → PASS.

- [ ] **Step 5: Write the failing feed test**

In `convex/feed.test.ts` (create if absent, mirroring other convex tests' imports), add:

```ts
test('feed.unseen excludes seen + not-interested, ranks the rest', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(api.seed.seed, {});
	const deviceId = 'reader';
	const first = await t.query(api.feed.unseen, {
		deviceId, paginationOpts: { numItems: 3, cursor: null }
	});
	expect(first.page.length).toBeGreaterThan(0);
	const firstId = first.page[0]._id;

	// Mark the first card seen, then it must never appear again.
	await t.mutation(api.events.log, {
		deviceId, sessionId: 's', events: [{ type: 'card_complete', cardId: firstId, ts: 1 }]
	});
	const after = await t.query(api.feed.unseen, {
		deviceId, paginationOpts: { numItems: 50, cursor: null }
	});
	expect(after.page.map((c) => c._id)).not.toContain(firstId);
});
```

- [ ] **Step 6: Run it — expect FAIL** (`api.feed.unseen` missing)

Run: `bunx vitest run convex/feed.test.ts` → FAIL.

- [ ] **Step 7: Replace `personal` with paginated `unseen`**

In `convex/feed.ts`, replace the file body:

```ts
import { query } from './_generated/server';
import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { scoreCard } from './profileLogic';

/**
 * Unseen feed (never-repeat at scale). Paginates published cards, HARD-EXCLUDES
 * cards in seenCards + the profile's notInterested, then ranks the surviving
 * page (light concept-affinity now; swap rankPage for AI scoring later). Never
 * collect()s all cards. Seen is the source of truth in seenCards (ADR-007).
 */
export const unseen = query({
	args: {
		deviceId: v.string(),
		paginationOpts: paginationOptsValidator,
		focusConcept: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const profile =
			args.deviceId.length === 0
				? null
				: await ctx.db
						.query('userProfiles')
						.withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
						.unique();
		const weights: Record<string, number> = {};
		for (const { concept, weight } of profile?.conceptWeights ?? []) weights[concept] = weight;
		const notInterested = new Set((profile?.notInterested ?? []).map(String));

		const page = await ctx.db
			.query('knowledgeCards')
			.withIndex('by_status_shuffle', (q) => q.eq('status', 'published'))
			.paginate(args.paginationOpts);

		const unseenCards = [];
		for (const card of page.page) {
			if (notInterested.has(card._id)) continue;
			if (args.deviceId.length > 0) {
				const seen = await ctx.db
					.query('seenCards')
					.withIndex('by_device_card', (q) =>
						q.eq('deviceId', args.deviceId).eq('cardId', card._id)
					)
					.unique();
				if (seen) continue;
			}
			unseenCards.push(card);
		}

		unseenCards.sort(
			(a, b) =>
				scoreCard(b.conceptTags, weights, { shuffleKey: b.shuffleKey, focusConcept: args.focusConcept }) -
				scoreCard(a.conceptTags, weights, { shuffleKey: a.shuffleKey, focusConcept: args.focusConcept })
		);

		return { ...page, page: unseenCards };
	}
});
```

- [ ] **Step 8: Run tests — expect PASS**

Run: `bunx vitest run convex/feed.test.ts convex/profileLogic.test.ts` → PASS. `bunx convex codegen` + `bun run check`.

- [ ] **Step 9: Commit**

```bash
git add convex/feed.ts convex/feed.test.ts convex/profileLogic.ts convex/profileLogic.test.ts
git commit -m "feat: unseen feed (paginate + hard-exclude seen); drop seen penalty"
```

---

### Task 5: Client consumes the paginated unseen feed

**Files:**
- Modify: `src/routes/+page.ts` (SSR-load the unseen feed)
- Modify: `src/routes/+page.svelte` (use the paginated unseen query; remove personal/base split)
- Test: manual + `bun run check` / `bun run test:component`

**Interfaces:**
- Consumes: `api.feed.unseen` (Task 4).

- [ ] **Step 1: SSR-load unseen**

In `src/routes/+page.ts`, the feed needs a `deviceId`, which is client-only — so SSR can't personalize. Load the unseen feed with an empty deviceId for the first paint (returns published, unfiltered, ranked by novelty), then the client re-subscribes with the real deviceId:

```ts
import { convexLoadPaginated } from 'convex-svelte/sveltekit';
import { api } from '$convex/_generated/api';

export const load = async () => ({
	feed: await convexLoadPaginated(
		api.feed.unseen,
		{ deviceId: '' },
		{ initialNumItems: 8 }
	)
});
```

- [ ] **Step 2: Switch the client feed to the paginated unseen subscription**

In `src/routes/+page.svelte`: remove the `personal = useQuery(api.feed.personal, ...)` block and the `liveCards = personal.data ?? feed.results` line. Drive the feed from a single paginated subscription keyed on the resolved `deviceId`. Use convex-svelte's paginated query hook (the same mechanism backing `data.feed`) with args `{ deviceId, focusConcept }`. Set `sourceCards` to the paginated `feed.results`. Keep `visibleResults = weaveFeed(sourceCards, injectedAfter).filter((c) => !notInterested.has(c._id))`, `feedItems`, the sentinel `loadMore`, and the Exhausted end-state as-is. (If convex-svelte requires `data.feed` to be the live store, re-key it to include `deviceId` once resolved per that library's SSR-to-live pattern.)

- [ ] **Step 3: Verify**

Run: `bun run check` → 0 errors; `bun run test:component` → pass; `bunx eslint src/`; `bunx prettier --check src/routes/+page.ts 'src/routes/+page.svelte'`.
Manual (dev server, `bun run dev`): scroll the feed; confirm cards load and paginate; complete a card, reload, confirm it does not reappear.

- [ ] **Step 4: Commit**

```bash
git add src/routes/+page.ts src/routes/+page.svelte
git commit -m "feat: client consumes paginated unseen feed"
```

---

### Task 6: Running-low trigger + faster generation

**Files:**
- Modify: `convex/generationPipeline.ts` (public `ensureSupply` action, throttled)
- Modify: `convex/crons.ts` (increase cadence; fix stale comment)
- Modify: `src/routes/+page.svelte` (call `ensureSupply` as the feed nears its end)
- Test: `convex/generationPipeline.test.ts` (create)

**Interfaces:**
- Consumes: `internal.generationPipeline.processDemand` (existing), `internal.demand.topConcepts`.
- Produces: `api.generationPipeline.ensureSupply({ deviceId })` → `{ triggered: boolean }`. Throttled so concurrent/rapid calls don't enqueue repeatedly.

- [ ] **Step 1: Write the throttle test**

Create `convex/generationPipeline.test.ts`. Since `processDemand` makes network calls (not runnable under convex-test), test ONLY the throttle gate via a tiny helper. In `generationPipeline.ts` add and export a pure helper:

```ts
/** True if enough time passed since the last supply trigger to trigger again. */
export function supplyThrottleOk(lastTriggeredAt: number | undefined, now: number, cooldownMs = 60_000): boolean {
	return lastTriggeredAt === undefined || now - lastTriggeredAt >= cooldownMs;
}
```

Test:

```ts
import { expect, test } from 'vitest';
import { supplyThrottleOk } from './generationPipeline';

test('supplyThrottleOk respects the cooldown', () => {
	expect(supplyThrottleOk(undefined, 1000)).toBe(true);
	expect(supplyThrottleOk(1000, 1000 + 59_000)).toBe(false);
	expect(supplyThrottleOk(1000, 1000 + 60_000)).toBe(true);
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `bunx vitest run convex/generationPipeline.test.ts` → FAIL (helper missing).

- [ ] **Step 3: Add `ensureSupply` + throttle state**

In `convex/generationPipeline.ts`, add the helper above, then a public action. Store throttle state in a tiny singleton table or reuse an existing one; simplest is a `supplyState` table. Add to `schema.ts`:

```ts
	supplyState: defineTable({ key: v.string(), lastTriggeredAt: v.number() }).index('by_key', ['key']),
```

Add an internal mutation + the public action in `generationPipeline.ts`:

```ts
export const readSupplyState = internalQuery({
	args: {},
	handler: async (ctx) =>
		(await ctx.db.query('supplyState').withIndex('by_key', (q) => q.eq('key', 'global')).unique())
			?.lastTriggeredAt
});

export const markSupplyTriggered = internalMutation({
	args: { now: v.number() },
	handler: async (ctx, { now }) => {
		const row = await ctx.db.query('supplyState').withIndex('by_key', (q) => q.eq('key', 'global')).unique();
		if (row) await ctx.db.patch(row._id, { lastTriggeredAt: now });
		else await ctx.db.insert('supplyState', { key: 'global', lastTriggeredAt: now });
	}
});

export const ensureSupply = action({
	args: { deviceId: v.string() },
	returns: v.object({ triggered: v.boolean() }),
	handler: async (ctx): Promise<{ triggered: boolean }> => {
		const now = Date.now();
		const last = await ctx.runQuery(internal.generationPipeline.readSupplyState, {});
		if (!supplyThrottleOk(last, now)) return { triggered: false };
		await ctx.runMutation(internal.generationPipeline.markSupplyTriggered, { now });
		await ctx.runAction(internal.generationPipeline.processDemand, { concepts: 6, perConcept: 3 });
		return { triggered: true };
	}
});
```

Add the needed imports (`action`, `internalQuery`, `internalMutation`, `internal`, `v`) if missing.

- [ ] **Step 4: Increase cron cadence + fix the stale comment**

In `convex/crons.ts`, change the interval and update the comment (it still references the removed review queue):

```ts
// A few times an hour, turn the top in-demand concepts into auto-published cards
// so the shared library stays ahead of consumption. Bounded by the Workpool's
// concurrency + per-run caps so it can never run away on cost.
crons.interval('generate from demand', { hours: 1 }, internal.generationPipeline.processDemand, {
	concepts: 6,
	perConcept: 3
});
```

- [ ] **Step 5: Wire the client trigger**

In `src/routes/+page.svelte`, add a `useMutation`-style action call (`getConvexClient().action(api.generationPipeline.ensureSupply, { deviceId })`) fired when the feed status becomes `Exhausted` or the sentinel intersects with few unseen left (near line 315 where `feed.loadMore` is called). Fire-and-forget; ignore the result. Guard on `deviceId` being set and `online`.

- [ ] **Step 6: Run tests + checks**

Run: `bunx vitest run convex/generationPipeline.test.ts` → PASS. `bunx convex codegen`, `bun run check`, `bun run test:component`, `bunx eslint convex/ src/`.

- [ ] **Step 7: Commit**

```bash
git add convex/generationPipeline.ts convex/crons.ts convex/schema.ts convex/generationPipeline.test.ts src/routes/+page.svelte
git commit -m "feat: running-low supply trigger + faster generation cadence"
```

---

### Task 7: Narrow — stop building/using `userProfiles.seen`

**Files:**
- Modify: `convex/profile.ts` (recompute no longer accumulates/writes `seen`)
- Modify: `convex/profile.ts` return validator + any test asserting `seen`
- Test: `convex/events.test.ts` or wherever recompute is asserted

**Interfaces:**
- Consumes: nothing new.
- Produces: `profile.recompute` returns `{ concepts, notInterested }` (no `seen`); `userProfiles` docs no longer get a `seen` array written (the field stays optional/unused in the schema; full removal is a later field-clear migration).

- [ ] **Step 1: Update recompute + its test**

In `convex/profile.ts`: remove `card_impression`/`card_skip`/`card_complete` from `SEEN_EVENTS` usage and the `seen` Set/field. Drop `seen` from the `profile` object written and from the `returns` validator (`v.object({ concepts: v.number(), notInterested: v.number() })`) and the return value. Keep `conceptWeights` + `notInterested`.

Update any test asserting `recompute(...).seen` (search `recompute` in `convex/*.test.ts`) to drop the `seen` assertion.

- [ ] **Step 2: Run tests — expect PASS after edits**

Run: `bunx vitest run convex/` (the convex project) → PASS. `bunx convex codegen` + `bun run check` → 0 errors. (Removing `seen` from the written object is safe because the schema field is optional from Task 1.)

- [ ] **Step 3: Commit**

```bash
git add convex/profile.ts convex/*.test.ts
git commit -m "feat: stop writing userProfiles.seen (seenCards is the source of truth)"
```

---

### Task 8: Verify, deploy to the LIVE deployment, migrate, confirm

**Files:** none (release task).

- [ ] **Step 1: Full verification**

Run: `bun run check` (0 errors); `bun run test:unit`; `bun run test:convex`; `bun run test:component` — all pass. `bunx eslint convex/ src/`.

- [ ] **Step 2: Push frontend + deploy backend to the deployment the site uses**

```bash
git push origin main          # Vercel auto-deploys the frontend
bunx convex dev --once        # pushes backend to the LIVE dev deployment (adept-spoonbill-177)
```
(Do NOT use `convex deploy` — that targets the unused prod deployment.)

- [ ] **Step 3: Run the seen migration on the live deployment**

```bash
npx convex run seenMigration:backfillSeen '{"limit":500}'
```
Re-run until `profilesScanned` is 0. (No `--prod`.)

- [ ] **Step 4: Confirm on the live site**

On `https://brain-rot-pro.vercel.app`: scroll the feed; complete several cards; reload and confirm completed cards do NOT reappear; confirm the feed keeps serving new cards past the old ~37 (generation + no-repeat). Optionally check `npx convex run feed:unseen '{"deviceId":"<id>","paginationOpts":{"numItems":5,"cursor":null}}'`.

- [ ] **Step 5: Final commit (if any tweaks)**

```bash
git add -A && git commit -m "chore: infinite-unseen-feed verification tweaks" && git push origin main
```

---

## Self-Review

- **Spec coverage:** seenCards table → T1; purge on delete → T2; migration (widen/migrate) → T1(widen)+T3; hard-exclude + select→rank + drop SEEN_PENALTY → T4; client paginated unseen → T5; running-low trigger + faster generation → T6; narrow → T7; deploy-to-correct-deployment + migrate → T8. ✓
- **Never-twice:** enforced by seenCards exclusion in `feed.unseen` (T4) + durable seen writes (T1). ✓
- **No collect()-all:** `feed.unseen` paginates (T4). ✓ (Per-candidate seen lookup is the known scale cliff; cursor optimization is the documented later step, not in scope.)
- **Type consistency:** `scoreCard(tags, weights, { shuffleKey, focusConcept? })` defined in T4 and used only in T4. `seenCards` shape + indexes defined T1, used T2/T3/T4. `ensureSupply({deviceId}) → {triggered}` defined + consumed in T6. `backfillSeen({limit}) → {profilesScanned, rowsInserted}` T3.
- **Placeholders:** none; each code step has concrete code. T5 client wiring names the exact files/lines and the convex-svelte SSR-to-live pattern to follow (the one existing in the repo).
- **Deployment correctness:** T8 uses `convex dev --once` + `convex run` (no `--prod`), per the Global Constraints / deployment memory.
