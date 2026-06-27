# W1 — Wonderwell Rebrand — Design

**Date:** 2026-06-26
**Workstream:** W1 of the public-launch program (see "Launch program" below).
**Status:** Approved, ready for implementation planning.

## Context

The product is named **"Brain Rot Pro"** across every user-facing surface, but the
public domain purchased is **wonderwell.app**. The public identity is being
rebranded to **Wonderwell**. This workstream makes every user-facing string say
"Wonderwell" while leaving internal identifiers untouched.

This is the first of six workstreams in the launch program; the others
(domain/deploy, privacy & legal, safety guardrails, security hardening, error
tracking) are tracked separately and out of scope here.

## Decisions (locked)

- **Public name:** `Wonderwell` (no "Pro" suffix). 10 chars — fits PWA `short_name`.
- **Tagline:** keep the hook *"One more idea, always."*; reframe the lead-in
  around curiosity/wonder rather than "knowledge cards."
  - **Long (meta/manifest description):**
    *"A zero-friction feed for the endlessly curious — surprising, source-backed sparks of wonder. One more idea, always."*
  - **Short (OG/Twitter fallback on `/c/[id]`):**
    *"Surprising, source-backed sparks of wonder. One more idea, always."*
- **Icon/glyph:** keep the existing glyph art in `static/icon.svg` and
  `static/favicon.svg`; only update the `aria-label`. Visual redesign deferred.
- **Internal identifiers:** unchanged. The `package.json` name stays
  `brain-rot-pro`; localStorage keys keep the `brp_` prefix (`brp_theme`,
  `brp_admin_token`); Convex deployment names unchanged. These are invisible to
  users and carry no value in renaming.

## Scope — exact change set

Display strings only. Each row is a user-visible "Brain Rot Pro" / "Brain Rot"
occurrence.

| File | Change |
|------|--------|
| `src/app.html` | `meta[name=apple-mobile-web-app-title]` `Brain Rot` → `Wonderwell`; `meta[name=description]` → **long tagline**. The inline `localStorage.getItem('brp_theme')` read stays (internal key). |
| `static/manifest.webmanifest` | `name` `Brain Rot Pro` → `Wonderwell`; `short_name` `Brain Rot` → `Wonderwell`; `description` → **long tagline**. |
| `src/service-worker.ts` (line ~30) | offline page copy `Brain Rot Pro needs a connection…` → `Wonderwell needs a connection…`. |
| `src/lib/share.ts` (line ~19) | `ShareData.title` `'Brain Rot Pro'` → `'Wonderwell'`. |
| `src/routes/+page.svelte` (line ~560) | `<title>Brain Rot Pro</title>` → `<title>Wonderwell</title>`. |
| `src/routes/c/[id]/+page.svelte` | fallback `title` `'Brain Rot Pro'` → `'Wonderwell'`; fallback `description` → **short tagline**; `<title>{title} · Brain Rot Pro</title>` → `· Wonderwell`; `og:site_name` → `Wonderwell`; back-link text `Brain Rot Pro` → `Wonderwell`. |
| `static/icon.svg`, `static/favicon.svg` | `role="img"` `aria-label="Brain Rot Pro"` → `aria-label="Wonderwell"`. Glyph paths untouched. |
| Tests | grep the test suite for `Brain Rot` and update any assertions on display strings (e.g. an `og:site_name` or `<title>` assertion). |
| `README.md`, `docs/README.md` | Title/first line → `Wonderwell` with a `(formerly Brain Rot Pro)` parenthetical. Internal design docs (`architecture-decisions.md`, `release-gates.md`, etc.) kept verbatim as historical record. |

## Out of scope (other workstreams)

- **W2 — Domain + deployment:** adding wonderwell.app on Vercel, DNS, `SITE_URL`,
  Google OAuth redirect URIs, canonical-origin wiring. The rebrand changes *names*,
  not *URLs*; the canonical/OG `og:url` already derives from `data.origin` at
  runtime and needs no edit here.
- Icon visual redesign.
- `brp_` → `ww_` storage-key rename.
- Deep rewrite of internal design docs.

## Error handling / edge cases

- `short_name` must stay ≤ ~12 chars for home-screen labels — `Wonderwell` (10) is fine.
- Changing display strings must not touch the `brp_theme` read in `app.html`'s
  pre-paint script, or the no-flash theme bootstrap breaks.
- The `/c/[id]` OG `og:url`/`canonical` derive from `data.origin` — leave as-is so
  they resolve to whatever origin serves the page (correct once W2 points the
  domain at it).

## Testing / verification

- `bun run verify` is green (typecheck + lint + unit + convex + component).
- `grep -rin "brain rot" src static` returns **no** user-facing matches (the only
  remaining `brp_`-prefixed hits are internal storage keys, which are intentional
  and not the literal string "brain rot").
- Manual smoke (post-merge, on the running app): browser tab title reads
  "Wonderwell"; `manifest.webmanifest` in DevTools shows the new name/short_name;
  the native share sheet title is "Wonderwell"; a `/c/[id]` page's view-source
  shows `og:site_name = Wonderwell` and the new fallback description.

## Launch program (context only — not this workstream)

| # | Workstream | Status |
|---|-----------|--------|
| **W1** | **Rebrand → Wonderwell** | **this spec** |
| W2 | Domain + deployment (wonderwell.app, `SITE_URL`, OAuth URIs, Convex prod posture) | pending |
| W3 | Privacy & legal (`/privacy`, consent/links, retention job; ⚖ counsel review in parallel) | pending |
| W4 | Safety guardrails (ingestion suppress-list + rank-time topic filter) | pending |
| W5 | Security hardening (admin auth → role/cookie; per-device rate limiting) | pending |
| W6 | Error tracking + resilience (`+error.svelte`, wire error tracking, reduced-motion/focus-trap, UA contact) | pending |

Human gates to start in parallel: ⚖ counsel review of the CC BY-SA reuse model;
Google OAuth console setup for wonderwell.app (unblocks the one untested B1 path,
Google sign-in → anon-data merge).
