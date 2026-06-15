# Brain Rot Pro

A zero-friction, AI-generated knowledge feed sourced from Wikipedia/Wikimedia — discrete, source-backed "one more idea" cards in an infinite vertical feed.

**Stack:** SvelteKit + Svelte 5 · Convex · `convex-svelte` (SSR-to-live) · Vercel AI SDK/Gateway (later) · deployed on Vercel.

Design, decisions, standards, and acceptance criteria live in **[`docs/`](./docs/)** — start with [`docs/README.md`](./docs/README.md).

## Quick start

```sh
npm install
npx convex dev          # one-time: configures a deployment and writes PUBLIC_CONVEX_URL
npm run convex:seed     # load the Phase-0 card library
npm run dev             # run the feed
```

Copy `.env.example` to `.env.local` if you set `PUBLIC_CONVEX_URL` manually.

## The verification loop

`npm run verify` is the iterate-until-green gate (typecheck → lint → unit → convex-test → component), all runnable offline. `npm run verify:full` adds Playwright e2e, which needs a live Convex deployment (`E2E_LIVE=1`). See [`docs/engineering-standards.md`](./docs/engineering-standards.md).

## Layout

- `src/` — SvelteKit app (the feed: `src/routes/+page.svelte`, `src/lib/components/Card.svelte`).
- `convex/` — backend: `schema.ts`, the `cards.feed` query, and `seed.ts` + `seedData.ts`.
- `docs/` — design review, architecture decisions, engineering standards, acceptance criteria.
