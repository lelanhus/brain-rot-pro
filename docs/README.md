# Brain Rot Pro — Documentation

A zero-friction, AI-generated knowledge feed sourced from Wikipedia/Wikimedia.

## Read in this order

1. **[`design-doc-v0.1-review.md`](./design-doc-v0.1-review.md)** — verification + gap analysis of the original design doc. Identifies the pre-MVP blockers (text licensing, rate limits, source-grounding, cold start) and the over-engineering risk. *Some decisions here are superseded — see #2.*
2. **[`architecture-decisions.md`](./architecture-decisions.md)** — **authoritative** locked decisions (ADRs), each confirmed with 2026 sources and caveats. The stack: SvelteKit + Svelte 5 + `convex-svelte`, Convex, Vercel AI SDK/Gateway, deferred Better Auth (anonymous + Google/Apple), Wikimedia free tier.
3. **[`engineering-standards.md`](./engineering-standards.md)** — *fail fast, never fail silently.* Conventions, the `convex-svelte` silent-failure footguns, testing strategy, and **the `npm run verify` loop** to iterate against.
4. **[`acceptance-criteria.md`](./acceptance-criteria.md)** — Definition of Done + per-phase 🤖 machine-checkable / 👤 human-judged gates. Phase 0 (card-quality spike) is the make-or-break.

## Current status

- Stack decisions: **locked** (architecture-decisions.md).
- Code: **not yet scaffolded** — no `package.json`. The `verify` loop in engineering-standards §4 is the spec the scaffold will implement.
- Next step: scaffold the SvelteKit + Convex app, wire `verify` + a SessionStart hook, then build the Phase 0 card-quality spike.
