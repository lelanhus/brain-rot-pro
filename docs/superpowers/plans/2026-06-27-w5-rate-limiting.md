# W5 Per-Device Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound any single device's use of the three expensive/abusable device-scoped paths (`ensureSupply`, `embeddings.forCard`, `interests.add`) with the `@convex-dev/rate-limiter` component, keyed off the B1 server-verified session subject, while real users never notice.

**Architecture:** Install the rate-limiter component; centralize the limit config + a test seam in a new `convex/rateLimits.ts`; guard each handler with a per-device token-bucket check keyed by the verified subject (never the client arg); surface a gentle toast on the client when a `rate_limited` `ConvexError` comes back. Enforcement is validated live (components don't run under convex-test here); the pure config/key/error logic is unit-tested.

**Tech Stack:** Convex (+ `@convex-dev/rate-limiter`), Better Auth (anonymous-first), SvelteKit + Svelte 5, vitest, bun.

## Global Constraints

- **Key = the server-verified session subject, NEVER the client `deviceId` arg.** Derive via `requireDevice`/`ownedDeviceOrEmpty` (which return `identity.subject`) or `ctx.auth.getUserIdentity()`.
- **Limits (token bucket, env-overridable rate; period & capacity fixed in code):**
  - `ensureSupply`: rate **5**, period **10 min**, capacity 5 — env `RL_ENSURE_SUPPLY_RATE`.
  - `forCard`: rate **30**, period **1 min**, capacity 30 — env `RL_FOR_CARD_RATE`.
  - `interestsAdd`: rate **20**, period **1 min**, capacity 20 — env `RL_INTERESTS_ADD_RATE`.
  - Env parse rule mirrors `maxCardsPerDay()`: `Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : default`.
- **On limit:** `ensureSupply` returns `{ triggered: false }` (NEVER throws — fire-and-forget). `forCard` and `interests.add` throw `ConvexError({ code: 'rate_limited', retryAfter })`.
- **Test seam:** a pure `rateLimitsDisabled()` (`process.env.RATE_LIMIT_DISABLED === '1'`) guards every `rateLimiter.limit()` call. The convex vitest project sets that env so the limiter no-ops in convex-test (components can't run there — `generationPipeline.test.ts:80`). Zero churn to existing tests.
- **Verified rate-limiter API** (use verbatim): `import rateLimiter from "@convex-dev/rate-limiter/convex.config.js"` + `app.use(rateLimiter)`; `new RateLimiter(components.rateLimiter, { name: { kind: "token bucket", rate, period, capacity } })`; `await rateLimiter.limit(ctx, name, { key })` → `{ ok: boolean, retryAfter: number }`; `MINUTE` is exported from `@convex-dev/rate-limiter`.
- Use `bun run` / `bunx`, never npm/npx. `vitest` sets `requireAssertions: true` — every test body must assert.
- Internal-only: no app schema change (the component owns its tables). Admin-auth is OUT of scope (deferred to W2).

---

### Task 1: Install + register the rate-limiter component

**Files:**

- Modify: `package.json` (+ `bun.lock`) — add dependency
- Modify: `convex/convex.config.ts`
- Modify: `convex/_generated/*` (regenerated, committed)

**Interfaces:**

- Consumes: nothing.
- Produces: `components.rateLimiter` available from `./_generated/api`; the package importable as `@convex-dev/rate-limiter`.

- [ ] **Step 1: Install the package**

Run: `bun add @convex-dev/rate-limiter`
Expected: it appears under `dependencies` in `package.json` and `bun.lock` updates.

- [ ] **Step 2: Register the component**

Edit `convex/convex.config.ts` to add the import and `app.use`, alongside the existing components:

```ts
import { defineApp } from 'convex/server';
import workpool from '@convex-dev/workpool/convex.config';
import betterAuth from '@convex-dev/better-auth/convex.config';
import rateLimiter from '@convex-dev/rate-limiter/convex.config.js';

// Bounded-concurrency + retrying job queue for demand-driven card generation
// (ingest → generate). One named pool keeps generation work isolated and rate-
// limited so a burst of demand never blows the Wikimedia / AI-Gateway limits.
const app = defineApp();
app.use(workpool, { name: 'generationPool' });
// Better Auth (Google sign-in) — durable cross-device identity.
app.use(betterAuth);
// Per-device rate limiting (W5 / B2) — token buckets keyed by session subject.
app.use(rateLimiter);

export default app;
```

- [ ] **Step 3: Regenerate the Convex API types**

Run: `bunx convex codegen`
Expected: `convex/_generated/api.d.ts` now exposes `rateLimiter` under `components`.
If codegen refuses to run without a deployment, run `bunx convex dev --once` instead (it deploys to the dev deployment AND regenerates) — acceptable here since the component must reach the dev deployment for live validation in Task 5 anyway.

- [ ] **Step 4: Verify typecheck sees the component**

Run: `bun run check`
Expected: PASS (svelte-check 0 errors). This confirms `components.rateLimiter` is generated and typed.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock convex/convex.config.ts convex/_generated
git commit -m "feat(ratelimit): install + register @convex-dev/rate-limiter component (W5)"
```

---

### Task 2: Rate-limit config module + test seam (TDD)

**Files:**

- Create: `convex/rateLimits.ts`
- Create: `convex/rateLimits.spec.ts` (convex vitest project, edge-runtime)
- Modify: `vite.config.ts` (set `RATE_LIMIT_DISABLED` for the convex project)
- Modify: `.env.example` (document the optional `RL_*` overrides)

**Interfaces:**

- Consumes: `components.rateLimiter` (Task 1).
- Produces, for Task 3:
  - `rateLimiter` — the configured `RateLimiter` instance; limit names `'ensureSupply' | 'forCard' | 'interestsAdd'`.
  - `rateLimitsDisabled(): boolean`
  - `forCardKey(subject: string | undefined): string`
  - `rateLimitedError(retryAfter?: number): ConvexError` with `data.code === 'rate_limited'`.

- [ ] **Step 1: Write the failing unit tests**

Create `convex/rateLimits.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ConvexError } from 'convex/values';
import {
	ensureSupplyLimit,
	forCardLimit,
	interestsAddLimit,
	forCardKey,
	rateLimitedError,
	rateLimitsDisabled
} from './rateLimits';

describe('rate-limit config', () => {
	it('ensureSupplyLimit defaults to rate 5 / 10 min token bucket', () => {
		const prev = process.env.RL_ENSURE_SUPPLY_RATE;
		delete process.env.RL_ENSURE_SUPPLY_RATE;
		const cfg = ensureSupplyLimit();
		expect(cfg).toEqual({ kind: 'token bucket', rate: 5, period: 10 * 60_000, capacity: 5 });
		if (prev === undefined) delete process.env.RL_ENSURE_SUPPLY_RATE;
		else process.env.RL_ENSURE_SUPPLY_RATE = prev;
	});

	it('forCardLimit honors a valid env override', () => {
		const prev = process.env.RL_FOR_CARD_RATE;
		process.env.RL_FOR_CARD_RATE = '50';
		const cfg = forCardLimit();
		expect(cfg.rate).toBe(50);
		expect(cfg.capacity).toBe(50);
		if (prev === undefined) delete process.env.RL_FOR_CARD_RATE;
		else process.env.RL_FOR_CARD_RATE = prev;
	});

	it('interestsAddLimit falls back to default on invalid env', () => {
		const prev = process.env.RL_INTERESTS_ADD_RATE;
		process.env.RL_INTERESTS_ADD_RATE = 'not-a-number';
		expect(interestsAddLimit().rate).toBe(20);
		if (prev === undefined) delete process.env.RL_INTERESTS_ADD_RATE;
		else process.env.RL_INTERESTS_ADD_RATE = prev;
	});
});

describe('rate-limit helpers', () => {
	it('forCardKey returns the subject, or "anon" when absent', () => {
		expect(forCardKey('sub_123')).toBe('sub_123');
		expect(forCardKey(undefined)).toBe('anon');
		expect(forCardKey('')).toBe('anon');
	});

	it('rateLimitedError is a ConvexError carrying code rate_limited', () => {
		const err = rateLimitedError(1234);
		expect(err).toBeInstanceOf(ConvexError);
		expect(err.data).toEqual({ code: 'rate_limited', retryAfter: 1234 });
	});

	it('rateLimitsDisabled reflects the RATE_LIMIT_DISABLED env', () => {
		const prev = process.env.RATE_LIMIT_DISABLED;
		process.env.RATE_LIMIT_DISABLED = '1';
		expect(rateLimitsDisabled()).toBe(true);
		process.env.RATE_LIMIT_DISABLED = '0';
		expect(rateLimitsDisabled()).toBe(false);
		if (prev === undefined) delete process.env.RATE_LIMIT_DISABLED;
		else process.env.RATE_LIMIT_DISABLED = prev;
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test:convex -- rateLimits`
Expected: FAIL — `./rateLimits` has no such exports yet.

- [ ] **Step 3: Implement `convex/rateLimits.ts`**

```ts
import { RateLimiter, MINUTE } from '@convex-dev/rate-limiter';
import { ConvexError } from 'convex/values';
import { components } from './_generated/api';

const TEN_MINUTES = 10 * MINUTE;

/** Env-overridable positive integer rate; invalid/unset → fallback (mirrors maxCardsPerDay). */
function envRate(name: string, fallback: number): number {
	const raw = Number(process.env[name]);
	return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export function ensureSupplyLimit() {
	const rate = envRate('RL_ENSURE_SUPPLY_RATE', 5);
	return { kind: 'token bucket' as const, rate, period: TEN_MINUTES, capacity: rate };
}

export function forCardLimit() {
	const rate = envRate('RL_FOR_CARD_RATE', 30);
	return { kind: 'token bucket' as const, rate, period: MINUTE, capacity: rate };
}

export function interestsAddLimit() {
	const rate = envRate('RL_INTERESTS_ADD_RATE', 20);
	return { kind: 'token bucket' as const, rate, period: MINUTE, capacity: rate };
}

/**
 * Per-device rate limits (W5 / release-gates B2). Keyed off the B1 server-verified
 * session subject so they can't be bypassed by spoofing the deviceId arg.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
	ensureSupply: ensureSupplyLimit(),
	forCard: forCardLimit(),
	interestsAdd: interestsAddLimit()
});

/**
 * Test seam: convex-test cannot run components in this repo (see
 * generationPipeline.test.ts), so the convex vitest project sets
 * RATE_LIMIT_DISABLED=1 and every limit call is guarded by this. In production
 * the env is unset and limits enforce normally.
 */
export function rateLimitsDisabled(): boolean {
	return process.env.RATE_LIMIT_DISABLED === '1';
}

/** Rate-limit key for forCard: the session subject, or a shared 'anon' bucket. */
export function forCardKey(subject: string | undefined): string {
	return subject !== undefined && subject.length > 0 ? subject : 'anon';
}

/** The typed error clients detect to show a gentle "slow down" toast. */
export function rateLimitedError(retryAfter?: number): ConvexError<{
	code: 'rate_limited';
	retryAfter: number | undefined;
}> {
	return new ConvexError({ code: 'rate_limited' as const, retryAfter });
}
```

- [ ] **Step 4: Wire the test-env seam**

In `vite.config.ts`, add `env` to the **convex** project's `test` block so the limiter no-ops there:

```ts
				{
					// Convex functions tested in-process with convex-test (no deployment needed).
					extends: './vite.config.ts',
					test: {
						name: 'convex',
						environment: 'edge-runtime',
						env: { RATE_LIMIT_DISABLED: '1' },
						include: ['convex/**/*.{test,spec}.ts'],
						server: { deps: { inline: ['convex-test'] } }
					}
				}
```

- [ ] **Step 5: Document the optional overrides in `.env.example`**

Add under the existing Convex-secrets block:

```sh
#   # Per-device rate limits (W5) — OPTIONAL. Defaults are generous; override the
#   # token-bucket refill rate per path (period/capacity fixed in code):
#   npx convex env set RL_ENSURE_SUPPLY_RATE "5"     # per 10 min/device
#   npx convex env set RL_FOR_CARD_RATE      "30"    # per min/device
#   npx convex env set RL_INTERESTS_ADD_RATE "20"    # per min/device
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run test:convex -- rateLimits`
Expected: PASS — all cases green.

- [ ] **Step 7: Commit**

```bash
git add convex/rateLimits.ts convex/rateLimits.spec.ts vite.config.ts .env.example
git commit -m "feat(ratelimit): config module, helpers, and test seam (W5)"
```

---

### Task 3: Wire rate limiting into the three handlers

**Files:**

- Modify: `convex/interests.ts` (the `add` mutation, ~line 7–27)
- Modify: `convex/generationPipeline.ts` (the `ensureSupply` action, ~line 209)
- Modify: `convex/embeddings.ts` (the `forCard` action, ~line 76)

**Interfaces:**

- Consumes from Task 2: `rateLimiter`, `rateLimitsDisabled`, `forCardKey`, `rateLimitedError`.
- Consumes existing: `requireDevice` / `ownedDeviceOrEmpty` (`./deviceIdentity`).
- Produces: per-device enforcement on all three paths. Client (Task 4) relies on the `rate_limited` `ConvexError` thrown by `forCard`/`interests.add`.

- [ ] **Step 1: Wire `interests.add`** (`convex/interests.ts`)

It already calls `requireDevice(ctx, deviceId)` — capture its returned subject and consume a token. Add imports at the top of the file:

```ts
import { rateLimiter, rateLimitsDisabled, rateLimitedError } from './rateLimits';
```

Change the `add` handler so the start reads:

```ts
	handler: async (ctx, { deviceId, slug, title }) => {
		const subject = await requireDevice(ctx, deviceId);
		if (!rateLimitsDisabled()) {
			const { ok, retryAfter } = await rateLimiter.limit(ctx, 'interestsAdd', { key: subject });
			if (!ok) throw rateLimitedError(retryAfter);
		}
		// ...existing body (lookup by_device_slug, insert, schedule discoverFor) unchanged
```

- [ ] **Step 2: Wire `ensureSupply`** (`convex/generationPipeline.ts`)

Import the helpers and `ownedDeviceOrEmpty`:

```ts
import { ownedDeviceOrEmpty } from './deviceIdentity';
import { rateLimiter, rateLimitsDisabled } from './rateLimits';
```

In the `ensureSupply` handler, **after** the existing global-cooldown check passes and **before** `markSupplyTriggered`, add the non-throwing per-device gate:

```ts
// Per-device fairness on top of the global cooldown. Soft subject so a
// transiently session-less call degrades to no-trigger, never an error.
const subject = await ownedDeviceOrEmpty(ctx, args.deviceId);
if (subject !== '' && !rateLimitsDisabled()) {
	const { ok } = await rateLimiter.limit(ctx, 'ensureSupply', { key: subject });
	if (!ok) return { triggered: false };
}
```

Note: `ensureSupply`'s arg is currently destructured as `_args`; rename to `args` (and drop the unused-var eslint-disable) so `args.deviceId` is available.

- [ ] **Step 3: Wire `forCard`** (`convex/embeddings.ts`)

Add imports:

```ts
import { ConvexError } from 'convex/values';
import { rateLimiter, rateLimitsDisabled, forCardKey, rateLimitedError } from './rateLimits';
```

At the very top of the `forCard` handler (before reading the target card):

```ts
	handler: async (ctx, args): Promise<Doc<'knowledgeCards'>[]> => {
		if (!rateLimitsDisabled()) {
			const identity = await ctx.auth.getUserIdentity();
			const { ok, retryAfter } = await rateLimiter.limit(ctx, 'forCard', {
				key: forCardKey(identity?.subject)
			});
			if (!ok) throw rateLimitedError(retryAfter);
		}
		// ...existing body unchanged
```

(If `ConvexError`/`rateLimitedError` import is unused because the throw uses `rateLimitedError`, keep only `rateLimitedError`; do not add an unused `ConvexError` import.)

- [ ] **Step 4: Verify the full suite stays green**

Run: `bun run verify`
Expected: green. The convex project has `RATE_LIMIT_DISABLED=1`, so the limiter no-ops and the existing `interests` / `forCard` tests (in `discovery.test.ts`, `interests.test.ts`, `feed.test.ts`, `embeddings.test.ts`) pass unchanged; typecheck/lint clean.

- [ ] **Step 5: Commit**

```bash
git add convex/interests.ts convex/generationPipeline.ts convex/embeddings.ts
git commit -m "feat(ratelimit): per-device limits on ensureSupply, forCard, interests.add (W5)"
```

---

### Task 4: Client — detect `rate_limited` and toast

**Files:**

- Modify: `src/lib/errors.ts` (add `isRateLimited`)
- Create: `src/lib/errors.spec.ts` (server project) — if no errors test exists yet
- Modify: `src/routes/+page.svelte` (forCard call ~line 449; addInterest call ~line 87)
- Modify: `src/lib/components/OnboardingSheet.svelte` (addInterest)

**Interfaces:**

- Consumes: the `rate_limited` `ConvexError` thrown by `forCard` / `interests.add` (Task 3).
- Produces: a gentle toast; no behavior change otherwise.

- [ ] **Step 1: Write the failing test for `isRateLimited`**

Create `src/lib/errors.spec.ts` (or add to the existing errors test if present):

```ts
import { describe, expect, it } from 'vitest';
import { ConvexError } from 'convex/values';
import { isRateLimited } from './errors';

describe('isRateLimited', () => {
	it('is true for a ConvexError with code rate_limited', () => {
		expect(isRateLimited(new ConvexError({ code: 'rate_limited', retryAfter: 1 }))).toBe(true);
	});
	it('is false for other ConvexErrors and plain errors', () => {
		expect(isRateLimited(new ConvexError({ code: 'unauthenticated' }))).toBe(false);
		expect(isRateLimited(new Error('nope'))).toBe(false);
		expect(isRateLimited(undefined)).toBe(false);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test:unit -- errors`
Expected: FAIL — `isRateLimited` not exported.

- [ ] **Step 3: Implement `isRateLimited`** in `src/lib/errors.ts`

```ts
import { ConvexError } from 'convex/values';

/** True when a thrown value is the server's `rate_limited` ConvexError. */
export function isRateLimited(err: unknown): boolean {
	return (
		err instanceof ConvexError &&
		typeof err.data === 'object' &&
		err.data !== null &&
		(err.data as { code?: unknown }).code === 'rate_limited'
	);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run test:unit -- errors`
Expected: PASS.

- [ ] **Step 5: Toast on the `forCard` call** (`src/routes/+page.svelte` ~line 449)

Wrap the existing `getConvexClient().action(api.embeddings.forCard, …)` call in try/catch. Use the page's existing toast instance (the page already creates one — match its variable name; if it is `toast`, use `toast.show`). On a rate-limit error, toast and treat related-cards as empty:

```ts
let related: typeof cards = [];
try {
	related = await getConvexClient().action(api.embeddings.forCard, {
		/* existing args */
	});
} catch (err) {
	if (isRateLimited(err)) toast.show('Slow down a moment');
	else throw err;
}
```

Add `import { isRateLimited } from '$lib/errors';` to the page script.

- [ ] **Step 6: Toast on the `addInterest` calls**

`src/routes/+page.svelte` (~line 87) currently does `void addInterest({ … })`. Replace the fire-and-forget with a catch:

```ts
		else addInterest({ deviceId, slug, title: card.source.articleTitle }).catch((err) => {
			if (isRateLimited(err)) toast.show('Slow down a moment');
			else throw err;
		});
```

In `src/lib/components/OnboardingSheet.svelte`, the add handler calls `addInterest(...)`; wrap its call the same way (import `isRateLimited` from `$lib/errors`, and use the component's toast if it has one, else add `import { createToast } from '$lib/toast.svelte'` and create one — match how sibling components surface toasts).

- [ ] **Step 7: Verify**

Run: `bun run verify`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/errors.ts src/lib/errors.spec.ts src/routes/+page.svelte src/lib/components/OnboardingSheet.svelte
git commit -m "feat(ratelimit): surface rate_limited as a gentle toast (W5)"
```

---

### Task 5: Live validation + release-gate update

**Files:**

- Modify: `docs/release-gates.md` (check off the B2 per-device item with the live result)

**Interfaces:**

- Consumes: a running `convex dev` deployment with the component (Task 1 Step 3 fallback, or `bunx convex dev --once` now).

- [ ] **Step 1: Deploy the backend to the dev deployment**

Run: `bunx convex dev --once`
Expected: pushes the rate-limiter component + the wired functions; no errors.

- [ ] **Step 2: Validate enforcement live**

Drive each limit past its bucket against the dev deployment and observe:

- `forCard`: call `api.embeddings.forCard` for a real published card id >30 times within a minute as one identity → a `ConvexError` with `data.code === 'rate_limited'` once the bucket empties; a second identity is unaffected.
- `ensureSupply`: call it >5 times in 10 min as one identity → `{ triggered: false }` after the cap (it must NOT throw).

Run (example, repeat to exceed the bucket):

```bash
bunx convex run embeddings:forCard '{"cardId":"<published id from convex run cards:feed>"}'
```

Record the observed `rate_limited` error and the second-identity pass.

- [ ] **Step 3: Update `docs/release-gates.md`**

In the **B2** section, check off the per-device rate-limit item, citing the live result (date + what was observed), matching the doc's existing `_(done YYYY-MM-DD)_` style. Note that admin-auth hardening remains tracked under W2.

- [ ] **Step 4: Commit**

```bash
git add docs/release-gates.md
git commit -m "docs(release-gates): B2 per-device rate limiting done + live-verified (W5)"
```

---

## Self-Review

**Spec coverage** (against `2026-06-27-w5-rate-limiting-design.md`):

- Component install + `app.use` → Task 1 ✓
- `rateLimits.ts` instance + pure helpers + seam + `forCardKey` + `rateLimitedError` → Task 2 ✓
- env-overridable limits, parse rule like `maxCardsPerDay()` → Task 2 Step 3 ✓
- Key = verified subject; `ensureSupply` soft/non-throwing, `forCard` auth-subject + 'anon' fallback, `interests.add` reuses `requireDevice` subject → Task 3 ✓
- On-limit behavior (return vs throw `rate_limited`) → Task 3 + Task 2 `rateLimitedError` ✓
- Client toast on `rate_limited` → Task 4 ✓
- Testing: pure unit tests + seam keeps existing convex-test green + live validation → Task 2/3/5 ✓
- `.env.example` override docs → Task 2 Step 5 ✓
- Admin-auth excluded → not present in any task ✓

**Placeholder scan:** every code step shows exact code; the only "existing body unchanged" notes are explicit boundaries around code shown elsewhere in the same file, not omissions. ✓

**Type/name consistency:** limit names `'ensureSupply' | 'forCard' | 'interestsAdd'` are identical in the `RateLimiter` config (Task 2) and every `rateLimiter.limit(ctx, …)` call (Task 3). `rateLimitedError` shape (`{ code, retryAfter }`) matches `isRateLimited`'s check (Task 4) and the unit tests. `forCardKey`/`rateLimitsDisabled` signatures match between definition (Task 2) and use (Task 3). ✓
