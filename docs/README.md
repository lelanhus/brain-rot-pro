# Brain Rot Pro — Documentation

A zero-friction, AI-generated knowledge feed sourced from Wikipedia/Wikimedia.

## Read in this order

1. **[`design-doc-v0.1-review.md`](./design-doc-v0.1-review.md)** — verification + gap analysis of the original design doc. Identifies the pre-MVP blockers (text licensing, rate limits, source-grounding, cold start) and the over-engineering risk. _Some decisions here are superseded — see #2._
2. **[`architecture-decisions.md`](./architecture-decisions.md)** — **authoritative** locked decisions (ADRs), each confirmed with 2026 sources and caveats. The stack: SvelteKit + Svelte 5 + `convex-svelte`, Convex, Vercel AI SDK/Gateway, deferred Better Auth (anonymous + Google/Apple), Wikimedia free tier.
3. **[`engineering-standards.md`](./engineering-standards.md)** — _fail fast, never fail silently._ Conventions, the `convex-svelte` silent-failure footguns, testing strategy, and **the `npm run verify` loop** to iterate against.
4. **[`acceptance-criteria.md`](./acceptance-criteria.md)** — Definition of Done + per-phase 🤖 machine-checkable / 👤 human-judged gates. Phase 0 (card-quality spike) is the make-or-break.

## Current status

- Stack decisions: **locked** (architecture-decisions.md).
- Code: **scaffolded** — SvelteKit + Svelte 5 + `convex-svelte`, Convex backend (`convex/`), and the Phase-0 card feed. The `verify` loop is wired and green.
- Next step: connect a Convex deployment (`npx convex dev`), seed (`npm run convex:seed`), and run the app for the Phase-0 "is it fun?" judgement; then expand the card set toward ~150–200.

## Running it

```bash
npm install
npx convex dev            # one-time: configure a deployment + write PUBLIC_CONVEX_URL
npm run convex:seed       # load the Phase-0 cards
npm run dev               # the feed
npm run verify            # the loop: typecheck + lint + unit + convex + component
```

`npm run verify` is the iterate-until-green gate (offline). `npm run verify:full` adds Playwright e2e, which needs a live deployment (set `E2E_LIVE=1`).
