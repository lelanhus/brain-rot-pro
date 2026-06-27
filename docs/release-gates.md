# Release Gates — Before Any External (non-Leland) User

**Last updated:** 2026-06-24
**Purpose:** the concrete, checkable work that stands between the current
single-user prototype and a safe public launch. This expands the three release
gates in [`acceptance-criteria.md`](./acceptance-criteria.md) §"Before any
external (non-Leland) user" (lines 108–115) with the findings from the
2026-06-24 pre-release audit.

Status snapshot at audit time: `npm run verify` is **green** (typecheck + lint +
285 tests), architecture is sound, PWA/SEO/a11y foundations are solid. The gaps
below are the prototype→multi-user hardening pass — not rework.

Markers: 🔴 blocker (a public launch is unsafe until this is done) ·
🟠 should-fix (do before launch or accept as a written, time-boxed risk) ·
🟡 polish. ⚖ = needs legal/counsel input.

**Progress (2026-06-24).** Closed and `verify`-green: B2 (seed + 10 ops/generation
actions made internal; daily generation cost cap added), B3 (image + text
attribution rendered with license-deed links), and the config-validation /
`.env.example` should-fixes. **B1 server-side enforcement is done and fully
tested** (every device-scoped function now trusts the session subject, not the
arg; forgery is refused — `convex/deviceIdentity.ts` + `.test.ts`; 297 tests
green). **B1 is implemented, merged, and live-verified on production** —
anonymous-session plugins, the client session bootstrap (`deviceId` = session
subject), and sign-in-to-sync (sync-codes retired). The deployed guards refuse a
forged/session-less `deviceId`; anonymous load + save + streak all work; live
testing caught and fixed three client timing bugs. Open should-fixes: privacy
policy, safety guardrails, admin-auth migration, error-tracking confirmation,
lockfile. (Google-sign-in→merge is the one B1 path not yet exercised live.)

---

## 🔴 Blockers

### B1 — The identity model is unauthenticated

Every device-scoped function trusts a client-supplied `deviceId: v.string()`
with only a non-empty check. The device id lives in `localStorage`
(`src/lib/identity.ts`), so it is fully forgeable: anyone can pass another user's
id to read, mutate, or erase their data.

**Approach:** the client `deviceId` becomes the caller's Better Auth session
subject (anonymous-first), and each public device-scoped function verifies the
claimed `deviceId` IS the caller's own session subject — instead of trusting the
arg. `requireDevice(ctx, claimed)` (`convex/deviceIdentity.ts`) is the chokepoint;
`ownedDeviceOrEmpty` is its soft variant for SSR read paths.

Server-side enforcement — **done and fully tested offline** via convex-test
`withIdentity` (the security contract lives in `convex/deviceIdentity.test.ts`:
a caller may act only as its own subject; forgery and no-session are both
refused):

- [x] `account.deleteData` — forging a deviceId can no longer erase another
      device. _(done 2026-06-24)_
- [x] `saved.toggle` / `list` / `savedIds` (`convex/saved.ts`)
- [x] `interests.add` / `remove` / `list` (`convex/interests.ts`; added internal
      `interests.byDevice` for trusted server callers like discovery)
- [x] `profile.recompute` (`convex/profile.ts`)
- [x] `stats.recordActivity` / `get` (`convex/stats.ts`)
- [x] `events.log` (`convex/events.ts`)
- [x] `sync.createCode` / `redeem` (`convex/sync.ts`)
- [x] `feed.unseen` (`convex/feed.ts`) — soft `ownedDeviceOrEmpty`: a forged id
      gets the global feed, never another device's personalization; SSR-safe.
- [x] All 85 test call sites migrated to `withIdentity`; `verify` green (297 tests).

Anonymous-session infrastructure — **wired, typecheck-clean** (runtime needs the
live app to verify):

- [x] Server: `anonymous()` plugin in `convex/auth.ts` with
      `disableDeleteAnonymousUser: true` and an `onLinkAccount` that merges the
      anon device's data into a signed-in account via the existing `applyLink`.
- [x] Client: `anonymousClient()` added to `src/lib/auth-client.ts`
      (`signIn.anonymous()`).

Client bootstrap + sync — **implemented, typecheck/`verify`-green; runtime needs
the live app** (the offline suite can't exercise session establishment):

- [x] **Client bootstrap.** `src/lib/deviceSession.svelte` establishes an
      anonymous session on first load and exposes `deviceId` = the session
      subject; `+layout.svelte` starts it; `+page` / `saved` / `search` / `account`
      read it reactively via `$derived`. `src/lib/identity.ts` is reduced to the
      analytics `getSessionId` only. Telemetry buffers events until the session
      resolves (events.log now needs the subject). _(done 2026-06-24)_
- [x] **Cross-device sync → sign-in-to-sync** (decision 2026-06-24). Retired the
      sync-code flow: removed `src/routes/sync/` and the client principal-swap;
      sign-in merge is handled server-side by `onLinkAccount`. The account page
      offers Google sign-in for cross-device sync. (Server `sync.createCode`/
      `redeem` remain, guarded but now client-unused — safe to delete in cleanup;
      likewise `accounts.linkDevice`, superseded by `onLinkAccount`.)

Live verification — **done on production 2026-06-24** (`brain-rot-pro.vercel.app`,
backend deployed via `convex dev --once`, client via push to main):

- [x] Anonymous first-load establishes a session (`isAnonymous: true`); feed
      renders via the soft path; a save persists; `recordActivity` records.
- [x] A forged / session-less `deviceId` is refused — `ConvexError:
unauthenticated` from `requireDevice` (verified via `convex run` + browser).
- [x] `feed.unseen` without a session returns the global feed (no leak, no throw).
- [ ] Google sign-in → anon-data merge (`onLinkAccount`) not yet exercised
      end-to-end (needs a real Google OAuth round-trip); server path is wired.

Bugs that **only live testing caught** (fixed, follow-up commits): `recordActivity`
fired at mount with an empty `deviceId`; an `isAuthenticated` gate that lagged the
token and delayed every device-scoped feature; the first `recordActivity` racing
the token. Known minor: on a **brand-new** visit, device-scoped writes activate
~10s in (anonymous sign-in + token round-trip); warm loads ~4s; the feed is
instant always. Worth optimizing later, not a blocker.

Then fold per-device rate-limiting (B2) onto `requireDevice`.

### B2 — Destructive / expensive functions are exposed to anonymous clients

- [x] **`seed.seed`** → `internalMutation` (`convex/seed.ts`). Still runnable via
      `npx convex run seed:seed`; no client SDK surface. Test fixtures switched to
      `internal.seed.seed`. _(done 2026-06-24)_
- [x] Converted ops/generation actions to `internalAction` (verified none are
      called from `src/`): `generate.generateFromArticle` / `generateBatch` /
      `backfillShortenOverlong`, `embeddings.backfillEmbeddings`,
      `ingest.ingestTitles` / `backfillImages` / `backfillScrim` / `topTitles`,
      `curation.auditEphemeralPublished`, `topics.classifyTopTopics`. Internal
      self-calls rewired `api.*` → `internal.*`; `verify` green. _(done 2026-06-24)_
- [x] **Added a daily generation cost cap.** `reserveGenerationSlot`
      (`generationPipeline.ts`) atomically reserves one slot per AI generation
      attempt against a per-UTC-day counter on the `supplyState` singleton;
      `generateForTopic` stops when the day's `MAX_CARDS_PER_DAY` (default 300) is
      hit. Bounds spend for **every** trigger — cron, `ensureSupply`, `interests`,
      and the `run` CLI alike. Pure `reserveDailyBudget` helper is unit-tested;
      the atomic reserve is convex-tested. _(done 2026-06-24)_
- [x] **Per-device rate-limit `ensureSupply` / `forCard` / `interests.add`.**
      Done (W5, 2026-06-27) via the `@convex-dev/rate-limiter` component, keyed off
      the **server-derived** B1 subject (never the arg), so forgery can't bypass it.
      Token buckets, env-overridable rates (`RL_*`); `ensureSupply` returns
      `{ triggered: false }` on limit (never throws), `forCard`/`interests.add`
      throw `ConvexError({ code: 'rate_limited' })` which the client surfaces as a
      gentle toast. Enforcement **live-verified** on the dev deployment: with
      `forCard` temporarily capped at 1, the first call returned and the next threw
      `{"code":"rate_limited","retryAfter":58548}` (default rate restored after).
      Pure config/key/error logic is unit-tested; components don't run under
      convex-test, so enforcement is validated live (mirrors the Workpool pattern).

### B3 — ⚖ Content-licensing attribution is half-met

`acceptance-criteria.md:112` calls for counsel review + rendered attribution.

- [x] **Render image attribution.** The depth sheet's `.source` block now shows
      a TASL image credit — author + the license short name linking to the license
      deed + a link back to the Commons file page (`Card.svelte`, `.image-credit`
      in `app.css`). Covered by two new component tests. _(done 2026-06-24)_
- [x] **Strengthened the text credit** — now names CC BY-SA 4.0, **links the
      license deed**, and states the adaptation is shared under the same license
      (`Card.svelte` `.license`). Wikimedia Attribution API adoption still open.
      _(done 2026-06-24)_
- [ ] ⚖ Counsel review of the CC BY-SA reuse model before launch. _(human gate)_

---

## 🟠 Should-fix

- [ ] **Privacy policy + consent + in-app legal links.** Collects deviceId +
      behavioral events (+ ad/affiliate clicks). The delete-cascade exists
      (`account.deleteData`); the policy, a `/privacy` link, and an
      event-retention/rollup job do not (`acceptance-criteria.md:113`).
- [x] **Safety guardrails — proactive.** Done (W4, 2026-06-27). A pure
      `classifySafety` (`convex/safetyLogic.ts`, **targeted** posture: always-block
      harm + advice-framed health; block politics/legal/tragedy only when
      _current_, so historical science/politics/medicine stay) is folded into the
      ingest chokepoint `decideArticleStatus` (`convex/wikidataLogic.ts`) — unsafe
      articles become `filtered_out` (`basis: 'safety: <reason>'`, logged in the
      per-title `decisions` log) and are never generated. **Rank-time is
      structural**: the feed serves only `published`, and nothing unsafe ever
      becomes/stays published. `convex/safety.ts:backfillSafety` (dry-run unless
      `apply`) re-classifies and suppresses already-published unsafe cards. The
      keyword lists are tunable against the `decisions` log. **Run live when
      deploys resume:** `bunx convex run safety:backfillSafety '{"apply":true,"nowYear":2026}'`.
      (Deferred: an LLM content-level check on generated card text.)
- [ ] **Admin auth is a localStorage token** (`src/lib/admin.svelte.ts`,
      `convex/adminAuth.ts`). Comparison is timing-safe, but the token is sent on
      every call and is XSS-stealable. Move to a Better Auth role / HTTP-only
      cookie before exposing `/admin`.
- [ ] **Confirm error tracking is actually wired.** `acceptance-criteria.md:19`
      assumes `handleError → Sentry`; verify the path is connected or prod errors
      vanish silently.
- [x] **Hardened config validation (fail loud, not silent).** `convex/auth.ts`
      now reads `SITE_URL` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` through a
      `requireEnv()` helper that throws a named error; `+layout.svelte` throws on
      a missing `PUBLIC_CONVEX_URL` instead of falling back to `''`.
      _(done 2026-06-24)_
- [x] **Completed `.env.example`** — documents `AI_GATEWAY_API_KEY` (+ model
      overrides), `SITE_URL`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and
      `ADMIN_TOKEN` as `convex env set` examples. _(done 2026-06-24)_
- [ ] **Resolve the lockfile conflict.** Both `bun.lock` and `package-lock.json`
      are committed with no source of truth. Project preference is **bun** — keep
      `bun.lock`, drop `package-lock.json`, and switch the README / `verify`
      scripts to `bun run`. (Or consciously commit to npm. Either way: one
      lockfile.)

---

## 🟡 Polish

- [ ] Add a top-level `src/routes/+error.svelte` boundary (feed has inline error
      states, but uncaught errors hit the default SvelteKit page).
- [ ] `convex/ingest.ts:18` puts a personal email in the Wikipedia User-Agent —
      consider a project/domain contact.
- [ ] Smooth-scroll calls (`+page.svelte:413,459`) don't check
      `prefers-reduced-motion`; the onboarding modal lacks a focus trap.

---

## Explicitly _not_ blockers (reviewed, defensible as-is)

- **`feed.unseen` per-card `seenCards` lookup** (`convex/feed.ts:58–70`) — it's
  an _indexed_ point lookup over a ~10–50-card page. Batch-collecting all seen
  rows by device would read tens of thousands of rows per page for a power user —
  strictly worse at the scale it's meant to fix. Leave it; revisit only if
  profiling shows it hot.
- **`admin.overview` full-table reads** (`convex/admin.ts:60`) — admin-only and
  self-documented; fine until the card count is large.

---

## Human-judged (Leland, per `acceptance-criteria.md:35–42`)

- [ ] Cards are "short, surprising, trustworthy" across a meaningful scroll.
- [ ] Decide whether the first external exposure is a **soft/internal launch**
      (some 🟠 gates may wait, recorded as risks) or a **public MVP** (all 🔴 +
      🟠 must pass).
