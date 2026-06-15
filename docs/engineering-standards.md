# Engineering Standards

**Last updated:** 2026-06-15
**Owner principle driving this doc:** *fail fast, fail loud, never fail silently.* Errors should surface at the earliest possible layer (type → validator → test → runtime report), and an unexpected error must never be swallowed.

This doc defines (1) the fail-fast conventions, (2) the known footguns to guard against, (3) the testing strategy, and (4) **the verification loop** — the single command an implementer (human or AI) iterates against until green.

---

## 1. Fail-fast conventions

### 1.1 Convex (backend)
- **Every** function declares **`args` and `returns` validators** (`v.*`). Public functions are internet-exposed; an unvalidated arg is a security and correctness hole. Enforce with the **`@convex-dev/require-argument-validators`** ESLint rule. ([validation](https://docs.convex.dev/functions/validation))
- **Schema validation stays ON** (`schemaValidation: true`, the default). Define every table in `schema.ts`. Writes that don't match are rejected. ([schemas](https://docs.convex.dev/database/schemas))
- **Use `ConvexError` for expected, user-facing failures** (`throw new ConvexError({ code, message })`). Its structured `.data` reaches the client even in production (plain errors are redacted to "Server Error"). ([application errors](https://docs.convex.dev/functions/error-handling/application-errors))
- **Let unexpected errors throw uncaught** — they bubble to the Convex dashboard logs with full stack traces and to the exception reporter. Do **not** `try/catch`-and-return-null.
- **No empty `catch {}`.** Either handle meaningfully, rethrow, or report. A swallowed error is a banned pattern.
- Generation/validation pipeline runs in **Workpool/Workflow** components (durable, retryable), not one 10-minute action.

### 1.2 Svelte / SvelteKit (frontend)
- TypeScript **`strict: true`**. No `any` without a written reason.
- **`svelte-check --fail-on-warnings`** in the gate — template/type diagnostics are hard failures.
- ESLint with **`no-floating-promises`** — an unawaited promise that can reject is a silent failure.
- Render query errors: `useQuery` returns `{ data, error, isLoading, isStale }` — **always handle `.error`**, and wrap subtrees in `<svelte:boundary onerror={...}>`. Inspect `error instanceof ConvexError` to render typed `.data`. ([svelte:boundary](https://svelte.dev/docs/svelte/svelte-boundary))
- Mutations: attach `.catch()` and surface the failure (toast/inline), never drop it.

### 1.3 Error visibility / observability
- **`@sentry/sveltekit`** wired through `handleError` in `hooks.server.ts` + `hooks.client.ts` (`Sentry.handleErrorWithSentry(...)`), `instrumentation.server.ts`, and the `sentrySvelteKit()` Vite plugin. `handleError` must **never throw**. ([SvelteKit hooks](https://svelte.dev/docs/kit/hooks), [Sentry SvelteKit](https://docs.sentry.io/platforms/javascript/guides/sveltekit/))
- Convex backend errors → Sentry + log streaming (Axiom/Datadog) per Convex best practice.
- Rule of thumb: **expected failure → `ConvexError` surfaced in UI; unexpected failure → bubble → `handleError` → Sentry.** Nothing is silent.

---

## 2. `convex-svelte` footguns (guard explicitly — these fail *silently*)

These are the traps most likely to violate the no-silent-failure rule. Source: [convex-svelte README](https://github.com/get-convex/convex-svelte), [docs request #154](https://github.com/get-convex/convex-backend/issues/154).

| Footgun | Symptom | Rule |
|---|---|---|
| **Args not passed as a getter** | Query **silently never updates** — *no error thrown* (worst kind). | **Always** `useQuery(api.fn, () => ({ ...reactiveState }))`, never `useQuery(api.fn, { ...state })`. Add a lint rule / code-review check. |
| `useQuery`/`useConvexClient` outside component init | Throws `lifecycle_outside_component`. | In `.svelte.ts`/utility/async code use the **singleton `getConvexClient()`** + `useMutation`/`useAction`; reserve `useQuery`/`useConvexClient` for component `<script>`. |
| `useQuery` inside a conditional or `$derived` | `effect_in_teardown` crash on conditionally-rendered components (modals). | Call `useQuery` **once, unconditionally**; toggle by returning `'skip'` from the args function. |
| `setupConvex()` not run before use | Context missing → query/client fail. | Call `setupConvex()` once in the **root `+layout.svelte`**. |
| SSR loading/null flash | Spinner or null flash on first paint. | Use `convexLoadPaginated()`/`convexLoad()` (the `convex-svelte/sveltekit` transport) — or `initialData` + `keepPreviousData`. |

---

## 3. Testing strategy

| Layer | Tool | Notes |
|---|---|---|
| Convex functions | **`convex-test`** (Vitest, `environment: "edge-runtime"`) | In-process mock of the backend. ⚠ It is a *mock* — also run **at least one pass against a real Convex deployment** for new code; it doesn't enforce size/time/arg limits, mock `fetch` inside actions / use `t.fetch()` for HTTP actions, crons unsupported. ([convex-test](https://docs.convex.dev/testing/convex-test)) |
| Svelte 5 components | **`vitest-browser-svelte`** + `@vitest/browser` + Playwright provider | Real-browser rendering (current standard; supersedes `@testing-library/svelte` + jsdom for components, since runes need a browser env). Use locators + retry-able `expect.element`. |
| Rune/logic units | Vitest, `*.svelte.test.ts` | Wrap effects in `$effect.root()`, call `flushSync()`. Keep a fast node/jsdom Vitest project for pure logic. |
| E2E | **`@playwright/test`** | Primary end-to-end. Drives the real feed (scroll, prefetch, skip/save). |
| Types + templates | **`svelte-check`** | Catches `.svelte` template/type errors `tsc` misses. |

**Mandatory tests tied to our risks/decisions:**
- A test proving the **`useQuery` getter-args** pattern actually re-fetches on state change (guards the #1 silent footgun).
- ⚠ When auth lands: a test proving **anonymous→Google/Apple linking carries the profile** via `onLinkAccount` (ADR-004).
- A test proving **SSR first paint has no loading/null flash** then upgrades to live (ADR-001).
- Source pipeline: a test proving **non-free/ambiguous-license images are rejected** (ADR-005), and that every card stores provenance (source URL, revision, span).
- Generation: a test proving a card below the **source-support threshold** is marked `validation_failed`, not published.

---

## 4. The verification loop  ← iterate against this until green

A single command, ordered cheapest/fastest-failing first; each step exits nonzero on failure and `&&` short-circuits, so the loop stops at the first red.

```jsonc
// package.json (to be wired at scaffold time)
{
  "scripts": {
    "typecheck": "svelte-check --tsconfig ./tsconfig.json --fail-on-warnings",
    "lint":      "eslint . && prettier --check .",
    "test:unit": "vitest run",                       // node/jsdom + browser-mode projects
    "test:convex": "vitest run --project convex",    // convex-test (edge-runtime)
    "test:e2e":  "playwright test",
    "verify":    "npm run typecheck && npm run lint && npm run test:unit && npm run test:convex && npm run test:e2e"
  }
}
```

- **`npm run verify` is THE gate.** Nonzero exit = not done; keep working. Zero = automated criteria satisfied.
- Run the same `verify` in CI. `test:e2e` may be split into its own CI job (needs `playwright install --with-deps`) for parallelism while staying one local command.
- A change is **not "done"** until `verify` is green **and** the relevant acceptance criteria in [`acceptance-criteria.md`](./acceptance-criteria.md) are met.

> Note: there is no `package.json` yet — this is the spec the scaffold will implement. Wiring `verify` (and a SessionStart hook so web sessions can run it) is the first task when we start building.

---

## 5. Toolchain note
Vite/Vitest/Rolldown/Oxc are now maintained by Cloudflare (VoidZero acquisition, June 2026) but remain MIT/open-source/vendor-neutral — stable, no migration needed. ([acquisition](https://siliconangle.com/2026/06/04/cloudflare-acquires-voidzero-maker-vite-javascript-toolchain/))
