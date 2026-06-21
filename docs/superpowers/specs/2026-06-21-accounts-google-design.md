# Accounts — Google sign-in + cross-device identity

**Date:** 2026-06-21
**Status:** Approved (pending spec review)

## Goal

Let a user sign in with Google so their seen-history, saves, streak, and taste
vector follow them across devices — without disturbing the anonymous-first
experience. Reuse the existing `deviceId`-principal data model and account-merge
machinery; auth just provides a durable identity that binds to a principal.

## Context (what exists)

- `deviceId` (a localStorage UUID, `src/lib/identity.ts`) IS the anonymous account
  principal. Every per-device table keys on it via `by_device`: `events`,
  `seenCards`, `savedCards`, `userProfiles`, `deviceStats`, `syncCodes`.
- `accountMerge.mergeAccounts(ctx, from, to)` folds one principal's data
  (saves / events / streak / profile) into another — explicitly
  "provider-agnostic … so wiring Better Auth is a thin call, not a rewrite."
- Sync codes (`sync.ts`) already let a device adopt another principal + merge;
  the client adopts a principal via `identity.setDeviceId(id)` then reloads.
- ADR-004 deferred real auth; `syncLogic.ts` names "Better Auth + Google/Apple"
  as the intended upgrade "seam." No auth library is installed yet.

## Decisions (from brainstorming)

- **OAuth-only, Google first.** No email/password (avoids password storage/reset
  surface). Apple deferred until/unless a native iOS app ships (App Store rules
  require Apple sign-in only when other social logins are offered in a native iOS
  app; web/PWA does not trigger this).
- **Anonymous-first.** Accounts are optional — an upgrade for cross-device sync.
  Unsigned users keep working exactly as today on their `deviceId`.
- **Library: Better Auth via the official Convex component** (`@convex-dev/better-auth`)
  + the community Svelte adapter (`@mmailaender/convex-better-auth-svelte`).
  Convex's first-party `@convex-dev/auth` does not support SvelteKit. Better Auth
  is framework-agnostic, an official Convex component, and does Google OAuth via
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.
- **Approach A — bind-principal-and-merge** (reuse the deviceId model; add one
  `accounts` mapping table; merge on sign-in; client adopts the principal).
  Rejected B (re-key every table to the auth userId — a rewrite + migration).

## Design

### 1. Better Auth integration (scaffold)
- Backend: `app.use(betterAuth)` in `convex/convex.config.ts`; `convex/auth.config.ts`
  configuring the Google social provider; mount Better Auth HTTP routes in
  `convex/http.ts` via `authComponent.registerRoutes()`. Read the signed-in user
  in Convex functions with `authComponent.getAuthUser(ctx)`.
- Client (SvelteKit): the `src/routes/api/auth/[...all]/+server.ts` proxy
  (`createSvelteKitHandler`); `createSvelteAuthClient({ authClient })` in
  `+layout.svelte` (integrates with the existing `convex-svelte` client); a
  server hook (`withServerConvexToken`) to extract the token; `getAuthState()` in
  a layout `load` for SSR. `useAuth()` exposes `isAuthenticated` / `isLoading`.
- Env (Convex deployment): `BETTER_AUTH_SECRET`, `SITE_URL`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; client/SSR uses existing
  `PUBLIC_CONVEX_URL` / `PUBLIC_CONVEX_SITE_URL`.
- Coexistence: auth wraps but does not replace the current `convex-svelte`
  real-time client or the SSR-to-live paginated feed.

### 2. Identity bridge — the testable core
- New table `accounts { authUserId: string, principal: string, createdAt }`,
  index `by_authUser` `['authUserId']` (+ `by_principal` for lookups).
- A mutation `linkDevice({ deviceId })` (reads the auth user via
  `authComponent.getAuthUser(ctx)`):
  - No `accounts` row for this auth user → **first sign-in**: create
    `{ authUserId, principal: deviceId }` (the account adopts this device's
    anonymous data in place). Return `{ principal: deviceId, merged: false }`.
  - Existing row → **returning/new device**: if `deviceId !== principal`,
    `mergeAccounts(ctx, deviceId, principal)`. Return `{ principal, merged }`.
- **Pure decision helper** `decideLink(existingPrincipal, deviceId)` →
  `{ principal, action: 'claim' | 'merge' | 'noop' }`, unit-tested without the
  auth component; the mutation is a thin wrapper around it + `mergeAccounts`
  (already tested). This keeps the auth-coupled part minimal.

### 3. Client glue
- When `useAuth().isAuthenticated` flips true and the device id has resolved:
  call `linkDevice({ deviceId })`, `identity.setDeviceId(principal)`, then reload
  so live queries re-subscribe under the account (same pattern as sync redeem).
- Account page (`src/routes/account/+page.svelte`): a **Sign in with Google**
  button (`authClient.signIn.social({ provider: 'google' })`) when anonymous, and
  a **Sign out** button when signed in. Sign-out: `authClient.signOut()`, then
  `identity.clearDeviceId()` + reload → reverts to a fresh anonymous device.
- The existing sync-code flow stays as a no-account fallback (unchanged).

### 4. Dev / testing story
- The identity bridge (`decideLink`, the merge) is unit-tested with a **simulated
  signed-in user** (convex-test `withIdentity`, or by testing `decideLink` purely
  + `mergeAccounts` directly) — **no Google credentials needed**, runs in CI.
- Google Cloud OAuth credentials (free, Testing mode) are configured only for the
  final end-to-end manual check.

## Deployment note
Better Auth's OAuth redirect + `SITE_URL` must match the deployment the live site
uses. Production runs on the Convex **dev** deployment `adept-spoonbill-177`
(Vercel `PUBLIC_CONVEX_URL`), so the Better Auth env vars + the Google authorized
redirect URI are set against THAT deployment (via `convex env`), and code reaches
it via `npx convex dev --once`. The Google redirect URI registers
`https://brain-rot-pro.vercel.app` (+ `http://localhost:5173` for dev).

## Non-goals
- Apple sign-in, email magic-link, email/password (deferred / dropped).
- Re-keying tables to the auth userId (approach B).
- Native iOS app.
- Account deletion via auth provider (the existing `account.deleteData` per-device
  purge remains; account-level deletion is a follow-up).

## Testing
- Unit: `decideLink` returns claim/merge/noop correctly (no row → claim; same
  principal → noop; different principal → merge).
- convex-test: `linkDevice` first sign-in creates the account with the device's
  principal; a second device's data is merged into the principal (reuses the
  `mergeAccounts` coverage). Simulate the auth user via `withIdentity`.
- Component: the Account page shows Sign-in when anonymous and Sign-out when
  authenticated (mock `useAuth`).
- Manual end-to-end (with Google creds): sign in on device A, sign in on device B,
  confirm B sees A's saves/streak; sign out reverts to anonymous.

## Open items
- Exact Better Auth Convex API symbols (`getAuthUser`, route registration,
  `withIdentity` shape) are pinned during implementation against the current
  `@convex-dev/better-auth` + `@mmailaender/convex-better-auth-svelte` docs
  (pin `better-auth@~1.6.15`).
- Whether to backfill an `accounts` row for any pre-existing data — not needed:
  first sign-in claims the current device's data automatically.
