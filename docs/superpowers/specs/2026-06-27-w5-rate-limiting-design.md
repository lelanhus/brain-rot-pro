# W5 (part 1) — Per-Device Rate Limiting — Design

**Date:** 2026-06-27
**Workstream:** W5 (Security hardening) of the public-launch program — **rate-limiting half only**.
**Status:** Approved, ready for implementation planning.

## Context

W5 has two independent halves: admin-auth hardening and per-device rate limiting.
Per the sequencing decision (2026-06-27), **only the rate-limiting half ships now**;
admin-auth is deferred to W2 (see "Deferred" below). This closes the remaining
open item of release-gate **B2**: per-actor fairness / anti-DoS on the expensive
and abusable device-scoped paths.

B1 is already done: every device-scoped public function verifies the claimed
`deviceId` IS the caller's Better Auth session subject via
`requireDevice(ctx, claimed)` (`convex/deviceIdentity.ts`), so a forged or
session-less caller is already refused. The daily generation **cost** cap
(`MAX_CARDS_PER_DAY`, `reserveGenerationSlot`) already bounds total AI spend.
What remains is bounding any **one actor's** share — that is this spec.

## Decisions (locked)

- **Approach:** the official `@convex-dev/rate-limiter` Convex component (token
  bucket), installed alongside `workpool` / `betterAuth` in `convex.config.ts`.
  Not a hand-rolled limiter.
- **Key = the caller's server-verified session subject**, never the client arg.
  Because B1 already binds `deviceId == identity.subject`, keying off the subject
  is forge-proof. Derivation per function below.
- **Targets** (the three named in release-gates B2): `ensureSupply`,
  `embeddings.forCard`, `interests.add`.
- **Limits are env-overridable** with sane defaults, mirroring the
  `maxCardsPerDay()` pattern (invalid/unset → default). Pure default-resolving
  helpers live in a testable module.
- **`ensureSupply` keeps its existing global 60 s cooldown** AND gains the
  per-device bucket: global bounds total cost, per-device bounds one actor.

## Limits & on-limit behavior

| Function                                        | Type         | Default limit (env override)                | Key derivation                                                                                                                                                             | On limit                                                                                               |
| ----------------------------------------------- | ------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ensureSupply` (action; triggers AI generation) | token bucket | ~5 per 10 min/device (`RL_ENSURE_SUPPLY_*`) | `ownedDeviceOrEmpty(ctx, deviceId)` — **non-throwing**; empty subject ⇒ skip the per-device bucket (global cooldown still applies)                                         | return `{ triggered: false }` (its existing fire-and-forget contract — **never throws to the client**) |
| `embeddings.forCard` (action; vector search)    | token bucket | ~30/min/device (`RL_FOR_CARD_*`)            | `ctx.auth.getUserIdentity()?.subject`; no session ⇒ a shared `'anon'` key so session-less callers are bounded collectively (signature unchanged — no `deviceId` arg added) | throw `ConvexError({ code: 'rate_limited' })`                                                          |
| `interests.add` (mutation)                      | token bucket | ~20/min/device (`RL_INTERESTS_ADD_*`)       | reuse the subject already returned by its existing `requireDevice(ctx, deviceId)` call                                                                                     | throw `ConvexError({ code: 'rate_limited' })`                                                          |

Defaults are deliberately generous — invisible to real use, tight enough to stop
scripted abuse. They are guardrails, not product limits.

## Components & files

- `convex/convex.config.ts` — `app.use(rateLimiter)`.
- **New** `convex/rateLimits.ts` — constructs the shared `RateLimiter` instance
  with the three named limits, reading env-overridable values through pure
  helpers (e.g. `ensureSupplyLimit()`, `forCardLimit()`, `interestsAddLimit()`),
  each returning `{ rate, period, capacity }` with the documented defaults.
  Exports a small `checkRateLimit(ctx, name, key)` wrapper that returns the
  component's `{ ok, retryAfter }` so call sites stay one line.
- `convex/generationPipeline.ts` — `ensureSupply`: after the global-cooldown
  check, derive the soft subject and, when non-empty, consume a per-device token;
  on `!ok` return `{ triggered: false }` without enqueuing a pass.
- `convex/embeddings.ts` — `forCard`: derive the subject, consume a token before
  the vector search; on `!ok` throw `rate_limited`.
- `convex/interests.ts` — `add`: after the existing `requireDevice`, consume a
  token; on `!ok` throw `rate_limited`.
- **Client** (`src/lib`): wherever `forCard` and `interests.add` are called,
  catch a `ConvexError` whose `data.code === 'rate_limited'` and surface a gentle
  toast (the `toast.svelte` util already exists) — e.g. "Slow down a moment."
  `ensureSupply` needs no client change (it already ignores its result shape
  beyond `triggered`).

## Error handling / edge cases

- **`ensureSupply` must never throw to the client.** Use the soft
  `ownedDeviceOrEmpty` (not `requireDevice`) so a transiently session-less call
  degrades to `{ triggered: false }`, not an error.
- **Forge-proofing is inherited from B1:** `interests.add` already refuses a
  forged/session-less caller via `requireDevice` _before_ the limiter runs, so
  the limiter key can never be another device's subject.
- **`forCard` session-less fallback:** bucketing under a shared `'anon'` key means
  the rare pre-session caller is still bounded and cannot stampede vector search.
- **Limit-config validation:** env values parse like `maxCardsPerDay()` —
  non-finite/≤0 ⇒ the documented default; never throws at boot.
- The rate-limiter component's own table is internal to the component; no app
  schema change.

## Testing

- **Unit** (`convex/rateLimits.spec.ts`, server project): the pure limit-resolving
  helpers — default when env unset, env override honored, invalid env ⇒ default.
- **Integration** (convex-test, `withIdentity`): for each target — the same actor
  exceeding its bucket is refused (`forCard`/`interests.add` throw `rate_limited`;
  `ensureSupply` returns `{ triggered: false }`); a **second** actor is unaffected
  (per-device isolation); the B1 refusal for a forged/session-less caller on
  `interests.add` still fires before the limiter.
- `bun run verify` green (typecheck + lint + unit + convex + component).

## Deferred (recorded — not this spec)

- **Admin-auth hardening → W2.** Decision locked: adopt the **Better Auth admin
  plugin** (role/permissions), drop the localStorage `ADMIN_TOKEN` (XSS-stealable),
  and gate `/admin` on an admin role carried by the existing HTTP-only session
  cookie. Lands with W2 once Google sign-in is live-verified (admins authenticate
  via Google; no other provider is configured).

## Launch program (context)

| #      | Workstream                                                           | Status        |
| ------ | -------------------------------------------------------------------- | ------------- |
| W1     | Rebrand → Wonderwell                                                 | done (live)   |
| W2     | Domain + deployment **+ admin-auth (Better Auth admin plugin)**      | pending       |
| W3     | Privacy & legal (+ Aggregate rollups, retention job)                 | pending       |
| W4     | Safety guardrails (ingestion suppress-list + rank-time topic filter) | pending       |
| **W5** | **Security hardening — rate limiting**                               | **this spec** |
| W6     | Error tracking + resilience                                          | pending       |
| (new)  | Image rehosting → Cloudflare R2 + Migrations                         | pending       |
