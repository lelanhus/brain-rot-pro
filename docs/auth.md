# Auth — Better Auth integration plan (ADR-004)

**Status:** foundation laid; dependency wiring deferred to a credentialed/live phase. Authored 2026-06-17.
**Implements:** ADR-004 (anonymous + Google + Apple via `@convex-dev/better-auth`).

## Why not fully wire Better Auth yet

`@convex-dev/better-auth` is pre-1.0 and version-pinned, and ADR-004 flags it **⚠ validate-on-adoption** — specifically requiring a test that proves the anonymous profile carries over on anonymous→Google/Apple linking, and Apple's client-secret-JWT / first-auth-only-email gotchas. None of that can be proven without Google/Apple OAuth credentials and a live HTTPS deployment. Shipping an unverifiable social-login flow would violate "never claim what you can't prove." So: build the seam now (no dependency, fully tested), drop Better Auth in when creds + a deploy exist.

## The seam (what makes this not throwaway)

The app is already shaped for this:

- **The `deviceId` _is_ the anonymous-account principal.** Every table (`savedCards`, `userProfiles`, `deviceStats`, `events`, `syncCodes`) keys on it. Better Auth's Anonymous plugin issues an anonymous user id with the same role — so the principal swap is localized, not a schema rewrite.
- **`accountMerge.mergeAccounts` is `onLinkAccount`.** Joining two accounts (saves union, recent events re-point, streak merge, drop the stale derived profile) is exactly what anonymous→social linking does. It's now extracted into `convex/accountMerge.ts` and reused by `/sync` redeem today; the Better Auth `onLinkAccount({ anonymousUser, newUser })` callback will call the same `internal.accountMerge.mergeInto`. One tested merge path, two callers.

## Done now (this PR)

- Extracted `mergeAccounts` from `sync.ts` into `convex/accountMerge.ts` + an internal `mergeInto` mutation; `/sync` reuses it. Behavior unchanged; covered by `accountMerge.test.ts`.

## Pending (credentialed/live phase)

1. **Add the dependency** — `@convex-dev/better-auth` (respect the pin; do **not** bump `better-auth` independently) + register the component in `convex.config.ts`.
2. **Plugins/providers** — Anonymous plugin + Google + Apple **only** (no email/password), per ADR-004.
3. **SvelteKit wiring** — `setupAuth()`/`useAuth()`, auth-aware SSR via `withServerConvexToken()`; a sign-in entry on `/sync` (which Better Auth's multi-device replaces) and a minimal account screen.
4. **Linking** — `onLinkAccount({ anonymousUser, newUser })` → `internal.accountMerge.mergeInto({ from: anonymousUser, to: newUser })`, with `disableDeleteAnonymousUser: true`.
5. **Principal swap** — resolve the app's principal from the Better Auth user id when authenticated, else the device id. Keep the device-id path as the anonymous default.
6. **Admin gate upgrade** — replace `assertAdmin(token)` (ADR-008/009 shared secret) with an `ctx.auth` role check; call sites are unchanged. Fold `/review` under `/admin`.

## ⚠ Validate-on-adoption (must prove before relying on it)

- A test proving the **anonymous profile carries over** on anonymous→Google/Apple linking (reported `onLinkAccount` non-firing bugs).
- **Apple:** client secret is a JWT that expires (~6 months) and must be regenerated; `clientId` is the Services ID; email/name returned **only on first authorization** — persist immediately; no localhost/non-HTTPS even in dev; add `https://appleid.apple.com` to `trustedOrigins`.
- Secrets (`GOOGLE_*`, `APPLE_*`, Better Auth secret) live on the Convex deployment, never as `PUBLIC_` vars.
