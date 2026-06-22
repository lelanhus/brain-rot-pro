# Onboarding Picker — Design Spec

**Date:** 2026-06-21 · **Status:** Self-approved (autonomous goal) · **Sub-project:** 5 of 6

## Goal
A one-time, skippable first-run interest picker so new users seed a few interests immediately, with a prompt to sign in to save them across devices. Reuses `topics.topByPageviews` (SP1) + `interests.add/remove` (SP3); frontend-only.

## Decisions (YAGNI)
- **First-run only, client-flagged.** A `localStorage` flag `brp:onboarded`; the picker shows on the feed when the flag is absent. "Start reading" or "Skip" sets the flag and dismisses — never shown again.
- **Suggested topics from `topByPageviews`** (limit ~18) as toggle chips; tapping follows/unfollows via `interests.add/remove` (same `followedSlugs` pattern). No search here (that's /search).
- **Sign-in prompt is a link, not embedded OAuth.** A line "Sign in to save your interests across devices" linking to `/account` (where Sign in with Google already lives). YAGNI — don't duplicate the OAuth flow.
- **Overlay on the feed**, not a separate route — avoids redirect logic; the feed renders it conditionally after mount.
- Anonymous-first preserved: picker works without sign-in; skipping is one tap; content (the feed) is never blocked behind it.
- No new Convex functions.

## Components
- `src/lib/onboarding.ts` (new): `isOnboarded()` / `markOnboarded()` — `localStorage` `brp:onboarded` helpers (SSR-safe: guard `typeof localStorage`).
- `src/lib/components/OnboardingSheet.svelte` (new): props `{ deviceId: string; onDone: () => void }`. `useQuery(api.topics.topByPageviews, () => ({ limit: 18 }))`; `interests.list`→`followedSlugs`; chips toggle follow; a "Sign in to save…" link to `/account`; a primary "Start reading" button → `onDone`. Heading + short subcopy. Calm styling (reuse tokens).
- `src/routes/+page.svelte` (modify): `showOnboarding` `$state` set `!isOnboarded()` in onMount (only when deviceId resolved); render `<OnboardingSheet {deviceId} onDone={() => { markOnboarded(); showOnboarding = false; }} />` as a full-screen overlay when `showOnboarding`.

## Data flow
```
first feed visit (no brp:onboarded) → OnboardingSheet
  topByPageviews(18) → suggested chips → tap → interests.add/remove
  "Start reading"/"Skip" → markOnboarded() → dismiss → feed (interests boost it)
```

## Error handling
- SSR-safe localStorage access (guarded); overlay only after mount + deviceId.
- deviceId guard on follow toggles.
- Skipping with zero picks is valid (flag still set).

## Testing
- Optional: a unit test for `onboarding.ts` (set/read flag) if the test env exposes localStorage; else covered by browser test.
- **Browser (human-like):** with the flag cleared, load the feed → onboarding appears → pick 2–3 topics (chips activate) → Start reading → overlay dismisses, feed shows; reload → onboarding does NOT reappear; picked topics appear in /account Interests.

## Scope boundary
No discovery (SP6); no embedded OAuth (links to /account); shown once per device (localStorage). The picker is suggestion-only (popular topics) — search remains the way to find specific topics.

## Risks
- localStorage flag is per-device/browser (re-shows on a new device) — acceptable and consistent with the anonymous-first model; signing in (the prompt's purpose) is how interests follow you.
