# Accounts — Google Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optional Google sign-in that binds a durable identity to the existing `deviceId` principal so saves/streak/seen/taste follow a user across devices.

**Architecture:** Better Auth (official Convex component + Svelte adapter) provides Google OAuth + a durable user. Approach A (bind-principal-and-merge): one `accounts(authUserId → principal)` table + a `linkDevice` mutation that claims the device's principal on first sign-in or merges it on a new device (reusing `accountMerge.mergeAccounts`); the client adopts the principal exactly like the existing sync-code redeem. Zero existing tables change; anonymous-first stays intact.

**Tech Stack:** SvelteKit + Convex + `convex-svelte`; Better Auth (`@convex-dev/better-auth`, `@mmailaender/convex-better-auth-svelte`, `better-auth@~1.6.15`); Vitest; bun.

## Global Constraints

- **Anonymous-first:** unsigned users keep working on their `deviceId` exactly as today. Accounts are optional.
- **OAuth-only, Google only this round.** No email/password, no Apple, no magic-link.
- **Reuse, don't re-key:** every per-device table stays keyed on the string principal. Add ONLY the `accounts` table. The merge is `accountMerge.mergeAccounts(ctx, from, to)`.
- **Testable core boundary:** the identity decision is a pure `decideLink`; the DB effect is `applyLink(ctx, authUserId, deviceId)` (convex-test-able with NO auth simulation). `linkDevice` is a thin auth-reading wrapper.
- **Deployment:** the live site uses the Convex DEV deployment `adept-spoonbill-177`. Better Auth env vars + the Google redirect URI target THAT deployment; backend reaches it via `npx convex dev --once`; env via `npx convex env set …` (no `--prod`). Google authorized redirect/origins: `https://brain-rot-pro.vercel.app` and `http://localhost:5173`.
- **Pin** `better-auth@~1.6.15`. Verify exact Better Auth Convex/Svelte API symbols against the current docs (https://labs.convex.dev/better-auth/framework-guides/sveltekit) — they evolve.
- Package manager **bun**. Verify with `bun run check`, `bunx vitest run convex/<file>`, `bunx eslint convex/ src/`, `bunx prettier --check <files>`. Do NOT run `bun run lint`.

## Execution Note (read before choosing subagent-driven)

- **Task 1 (Better Auth scaffold) is a vendor-guided integration** — it follows the official Convex+Better Auth SvelteKit guide, needs Google Cloud OAuth credentials, and typically needs hands-on iteration (env on the right deployment, redirect URIs, SvelteKit hooks/SSR, coexistence with the existing `convex-svelte` client). It is NOT cleanly TDD-able and should be done **interactively (with the user's Google credentials), not by a fire-and-forget subagent.**
- **Tasks 2–4 are codebase work** (the identity bridge, UI glue, verification) with concrete code; Task 2 is fully TDD-able and subagent-friendly.
- Recommended order: do **Task 2 first** (pure, testable, no creds — delivers + de-risks the core), then Task 1 interactively once Google creds exist, then Task 3, then Task 4.

---

### Task 2: Identity bridge — `accounts` table + `decideLink` + `applyLink` + `linkDevice`

(Listed first because it's the testable core and needs no Better Auth / credentials. `linkDevice`'s single auth call is the only Better-Auth-coupled line.)

**Files:**

- Create: `convex/accountsLogic.ts` (pure `decideLink`)
- Create: `convex/accounts.ts` (`applyLink` internal mutation + `linkDevice` mutation)
- Modify: `convex/schema.ts` (add `accounts` table)
- Test: `convex/accountsLogic.test.ts`, `convex/accounts.test.ts`

**Interfaces:**

- Consumes: `accountMerge.mergeAccounts(ctx, from, to)` (existing).
- Produces: `decideLink(existingPrincipal: string | null, deviceId: string) => { principal: string; action: 'claim' | 'merge' | 'noop' }`; `internal.accounts.applyLink({ authUserId, deviceId }) => { principal: string; merged: boolean }`; `api.accounts.linkDevice({ deviceId }) => { principal: string; merged: boolean }`.

- [ ] **Step 1: Write the failing `decideLink` tests**

Create `convex/accountsLogic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decideLink } from './accountsLogic';

describe('decideLink', () => {
	it('claims the device as the principal on first sign-in (no account yet)', () => {
		expect(decideLink(null, 'devA')).toEqual({ principal: 'devA', action: 'claim' });
	});
	it('is a no-op when the device already IS the principal', () => {
		expect(decideLink('devA', 'devA')).toEqual({ principal: 'devA', action: 'noop' });
	});
	it('merges when signing in on a different device', () => {
		expect(decideLink('devA', 'devB')).toEqual({ principal: 'devA', action: 'merge' });
	});
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bunx vitest run convex/accountsLogic.test.ts` → FAIL (`decideLink` missing).

- [ ] **Step 3: Implement `decideLink`**

Create `convex/accountsLogic.ts`:

```ts
/**
 * Pure rule for binding a signed-in user to a principal (the deviceId-style
 * account key). No account yet → claim this device's data as the account.
 * Already this device → nothing to do. A different device → merge it in.
 */
export function decideLink(
	existingPrincipal: string | null,
	deviceId: string
): { principal: string; action: 'claim' | 'merge' | 'noop' } {
	if (existingPrincipal === null) return { principal: deviceId, action: 'claim' };
	if (existingPrincipal === deviceId) return { principal: existingPrincipal, action: 'noop' };
	return { principal: existingPrincipal, action: 'merge' };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bunx vitest run convex/accountsLogic.test.ts` → PASS.

- [ ] **Step 5: Add the `accounts` schema table**

In `convex/schema.ts`, add (next to `userProfiles`/`syncCodes`):

```ts
	// Maps a Better Auth user to the deviceId-style principal their per-device
	// data lives under (approach A — no table re-keying).
	accounts: defineTable({
		authUserId: v.string(),
		principal: v.string(),
		createdAt: v.number()
	})
		.index('by_authUser', ['authUserId'])
		.index('by_principal', ['principal']),
```

- [ ] **Step 6: Write the failing `applyLink` tests**

Create `convex/accounts.test.ts`:

```ts
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('applyLink claims the device principal on first sign-in', async () => {
	const t = convexTest(schema, modules);
	const r = await t.mutation(internal.accounts.applyLink, { authUserId: 'u1', deviceId: 'devA' });
	expect(r).toEqual({ principal: 'devA', merged: false });
	const row = await t.run(async (ctx) =>
		ctx.db
			.query('accounts')
			.withIndex('by_authUser', (q) => q.eq('authUserId', 'u1'))
			.unique()
	);
	expect(row?.principal).toBe('devA');
});

test('applyLink merges a new device into the existing principal', async () => {
	const t = convexTest(schema, modules);
	await t.mutation(api.seed.seed, {}); // gives devB a card to save so the merge has data
	// First sign-in on devA claims it.
	await t.mutation(internal.accounts.applyLink, { authUserId: 'u1', deviceId: 'devA' });
	// devB saves a card, then the same user signs in on devB → merge devB into devA.
	const feed = await t.query(api.cards.feed, { paginationOpts: { numItems: 1, cursor: null } });
	await t.mutation(api.saved.toggle, { deviceId: 'devB', cardId: feed.page[0]._id });
	const r = await t.mutation(internal.accounts.applyLink, { authUserId: 'u1', deviceId: 'devB' });
	expect(r).toEqual({ principal: 'devA', merged: true });
	// devB's save now lives under devA (the principal).
	expect(await t.query(api.saved.savedIds, { deviceId: 'devA' })).toContain(feed.page[0]._id);
});
```

(Add `import { api } from './_generated/api';` to the test imports.)

- [ ] **Step 7: Run — expect FAIL**

Run: `bunx vitest run convex/accounts.test.ts` → FAIL (`internal.accounts.applyLink` missing).

- [ ] **Step 8: Implement `applyLink` + `linkDevice`**

Create `convex/accounts.ts`:

```ts
import { internalMutation, mutation } from './_generated/server';
import { v } from 'convex/values';
import { decideLink } from './accountsLogic';
import { mergeAccounts } from './accountMerge';
import { authComponent } from './auth'; // exported by the Better Auth scaffold (Task 1)

/**
 * Bind an auth user to a principal and (if needed) merge a device's anonymous
 * data into it. Internal + authUserId-as-arg so it's unit-testable without the
 * auth component (the auth read happens only in `linkDevice`).
 */
export const applyLink = internalMutation({
	args: { authUserId: v.string(), deviceId: v.string() },
	returns: v.object({ principal: v.string(), merged: v.boolean() }),
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('accounts')
			.withIndex('by_authUser', (q) => q.eq('authUserId', args.authUserId))
			.unique();
		const decision = decideLink(existing?.principal ?? null, args.deviceId);
		if (decision.action === 'claim') {
			await ctx.db.insert('accounts', {
				authUserId: args.authUserId,
				principal: decision.principal,
				createdAt: Date.now()
			});
			return { principal: decision.principal, merged: false };
		}
		if (decision.action === 'merge') {
			await mergeAccounts(ctx, args.deviceId, decision.principal);
			return { principal: decision.principal, merged: true };
		}
		return { principal: decision.principal, merged: false };
	}
});

/**
 * Called by the client right after Google sign-in. Resolves the auth user and
 * binds/merges the current device. Returns the principal to adopt client-side.
 */
export const linkDevice = mutation({
	args: { deviceId: v.string() },
	returns: v.object({ principal: v.string(), merged: v.boolean() }),
	handler: async (ctx, args): Promise<{ principal: string; merged: boolean }> => {
		if (args.deviceId.length === 0) throw new Error('linkDevice: deviceId is required');
		const user = await authComponent.getAuthUser(ctx);
		if (!user) throw new Error('linkDevice: not authenticated');
		// PIN the exact id field from the Better Auth docs (`user._id` or `user.userId`).
		const authUserId = user._id;
		return await ctx.runMutation(internal.accounts.applyLink, {
			authUserId,
			deviceId: args.deviceId
		});
	}
});
```

NOTE: `linkDevice` imports `authComponent` from `./auth` (created in Task 1) and uses `internal` (`import { internal } from './_generated/api';`). If implementing Task 2 BEFORE Task 1, stub `convex/auth.ts` to `export const authComponent = { getAuthUser: async () => null };` so `bun run check` passes and the `applyLink`/`decideLink` tests run; Task 1 replaces the stub with the real component.

- [ ] **Step 9: Run — expect PASS**

Run: `bunx convex codegen` then `bunx vitest run convex/accountsLogic.test.ts convex/accounts.test.ts` → PASS. `bun run check` → 0 errors. `bunx eslint convex/` + `bunx prettier --check convex/accounts.ts convex/accountsLogic.ts convex/schema.ts convex/accounts.test.ts convex/accountsLogic.test.ts`.

- [ ] **Step 10: Commit**

```bash
git add convex/accounts.ts convex/accountsLogic.ts convex/schema.ts convex/accounts.test.ts convex/accountsLogic.test.ts convex/auth.ts
git commit -m "feat: accounts identity bridge (decideLink + applyLink + linkDevice)"
```

---

### Task 1: Better Auth scaffold (Google) — INTERACTIVE / vendor-guided

**Do this with the user present and their Google credentials. Follow the official guide: https://labs.convex.dev/better-auth/framework-guides/sveltekit (pin exact symbols from it).**

**Files (per the guide):**

- Install: `@convex-dev/better-auth`, `@mmailaender/convex-better-auth-svelte`, `better-auth@~1.6.15`.
- Create/modify: `convex/convex.config.ts` (`app.use(betterAuth)`), `convex/auth.config.ts` (Google provider), `convex/http.ts` (`authComponent.registerRoutes()`), `convex/auth.ts` (export `authComponent` — REPLACES the Task-2 stub).
- Client: `src/routes/api/auth/[...all]/+server.ts` (`createSvelteKitHandler`), `src/routes/+layout.svelte` (`createSvelteAuthClient({ authClient })`), `src/hooks.server.ts` (`withServerConvexToken`), `src/routes/+layout.server.ts` or `+layout.ts` (`getAuthState()` for SSR).

- [ ] **Step 1: Get Google OAuth credentials** — Google Cloud project → OAuth consent screen (Testing mode) → Web client; authorized origins `https://brain-rot-pro.vercel.app`, `http://localhost:5173`; redirect URIs per the Better Auth guide. (User action.)
- [ ] **Step 2: Set Convex env on the LIVE (dev) deployment**: `npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"`, `npx convex env set SITE_URL https://brain-rot-pro.vercel.app`, `npx convex env set GOOGLE_CLIENT_ID …`, `npx convex env set GOOGLE_CLIENT_SECRET …` (no `--prod`).
- [ ] **Step 3: Install packages + add the backend component** (convex.config, auth.config Google, http.ts, auth.ts) per the guide. `bunx convex dev --once` to push.
- [ ] **Step 4: Wire the SvelteKit client** (route proxy, layout provider, server hook, SSR load) per the guide, ensuring it coexists with the existing `convex-svelte` client + the SSR-to-live feed.
- [ ] **Step 5: Verify** `bun run check` → 0 errors; the app still loads anonymously; the Better Auth routes resolve. Replace the Task-2 `auth.ts` stub with the real `authComponent` and re-run `bunx vitest run convex/accounts.test.ts` (still green — `applyLink` is unaffected).
- [ ] **Step 6: Commit** the scaffold (`feat: Better Auth (Google) scaffold`).

---

### Task 3: Client glue — sign in/out + link-on-auth

**Files:**

- Modify: `src/routes/account/+page.svelte` (Sign in with Google / Sign out in the existing "Devices" panel)
- Modify: `src/routes/+page.svelte` or a shared place (on-auth `linkDevice` → adopt principal → reload)
- Test: component test for the Account page auth controls (mock `useAuth`)

**Interfaces:**

- Consumes: `api.accounts.linkDevice` (Task 2); Better Auth `authClient` + `useAuth()` (Task 1); `identity.setDeviceId`/`clearDeviceId` (existing).

- [ ] **Step 1: Add the on-auth link effect.** Where the feed/layout resolves `deviceId`, add: when `useAuth().isAuthenticated` becomes true and `deviceId` is set, call `getConvexClient().mutation(api.accounts.linkDevice, { deviceId })`; on success `identity.setDeviceId(result.principal)` and `location.reload()` (same adopt-and-reload pattern as `/sync` redeem). Guard so it runs once per auth transition.

- [ ] **Step 2: Account page controls.** In `src/routes/account/+page.svelte`, replace the "Google & Apple sign-in … is coming" note in the Devices panel with real controls: when anonymous, a **Sign in with Google** button calling `authClient.signIn.social({ provider: 'google' })`; when authenticated (`useAuth().isAuthenticated`), a **Sign out** button calling `authClient.signOut()` then `identity.clearDeviceId()` + `location.assign('/')` (revert to a fresh anonymous device). Keep the existing sync-code link as a secondary option.

- [ ] **Step 3: Component test.** Add/extend a `+page.svelte.spec` (vitest-browser-svelte) that mocks `useAuth` to assert the Sign-in button shows when unauthenticated and Sign-out shows when authenticated. (Match the project's existing component-test style.)

- [ ] **Step 4: Verify + commit.** `bun run check` → 0; `bun run test:component` → pass; eslint + prettier on the touched files.

```bash
git add src/routes/account/+page.svelte src/routes/+page.svelte src/routes/account/+page.svelte.spec.ts
git commit -m "feat: Google sign-in/out UI + link-device on auth"
```

---

### Task 4: Verify, deploy, end-to-end confirm

- [ ] **Step 1: Full verification.** `bun run check` (0 errors); `bun run test:unit`/`test:convex`/`test:component` all pass; `bunx eslint convex/ src/`.
- [ ] **Step 2: Deploy.** `git push origin main` (Vercel frontend); `bunx convex dev --once` (backend → live dev deployment). Confirm the Better Auth env vars are set on that deployment (`npx convex env list`).
- [ ] **Step 3: End-to-end (with Google creds).** On `https://brain-rot-pro.vercel.app`: sign in with Google on device/browser A; save a card + build a little streak; sign in with Google on browser B; confirm B sees A's saves/streak (merge). Sign out → reverts to a fresh anonymous device.
- [ ] **Step 4: Final commit** (any tweaks): `git add -A && git commit -m "chore: accounts verification tweaks" && git push origin main`.

---

## Self-Review

- **Spec coverage:** Better Auth scaffold + Google + env/deployment → Task 1; `accounts` table + `linkDevice` claim/merge reusing `mergeAccounts`, testable core (`decideLink`/`applyLink`) → Task 2; client sign-in/out + link-on-auth + adopt-principal → Task 3; verify/deploy/e2e → Task 4. ✓
- **Anonymous-first preserved:** no existing table re-keyed; unsigned path untouched; accounts add-only. ✓
- **Testability:** `decideLink` pure + `applyLink` convex-test-able with NO auth simulation (authUserId passed directly); only `linkDevice`'s single `getAuthUser` line is Better-Auth-coupled and integration-verified. ✓
- **Type consistency:** `decideLink(string|null, string) → {principal, action}` (T2) used by `applyLink` (T2); `applyLink({authUserId,deviceId}) → {principal,merged}` consumed by `linkDevice` (T2) and client (T3); `accounts{authUserId,principal,createdAt}` defined T2, used T2. `authComponent.getAuthUser` from `./auth` (T1 stub → real).
- **Placeholders:** Task 2 has full code. Tasks 1/3/4 are vendor-integration + UI: Task 1 is explicitly an interactive vendor-guided task (the one part not pre-codeable from current knowledge, flagged in the Execution Note); Task 3 names exact symbols + the adopt-reload pattern. Exact Better Auth API ids are pinned from the live guide per Global Constraints.
- **Deployment:** Tasks 1/4 use `convex dev --once` + `convex env` (no `--prod`) and target the live dev deployment; Google redirect URIs registered for prod + localhost.
