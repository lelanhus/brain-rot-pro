# Onboarding Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A one-time, skippable first-run interest picker on the feed (suggested popular topics + sign-in-to-save link).

**Architecture:** Frontend-only. A localStorage `brp:onboarded` flag gates a full-screen `OnboardingSheet` overlay rendered on the feed. Chips follow topics via existing `api.interests.add/remove`; suggestions from `api.topics.topByPageviews`. No new Convex functions.

**Tech Stack:** SvelteKit/Svelte 5 runes, convex-svelte.

## Global Constraints

- Reuse `api.topics.topByPageviews` + `api.interests.{add,remove,list}`. No backend changes.
- One-time per device via `localStorage` `brp:onboarded` (SSR-safe access). Skipping/Start sets the flag; never blocks content.
- convex-svelte getter-args + 'skip'; deviceId guard on follow toggles; underscores→spaces for display + stored title.
- Reuse CSS tokens (verify each `var(--…)` exists in `src/app.css`; fall back to an existing token if not). No magic px beyond rem spacing consistent with existing components.
- Verify: `bun run check` (0) + `bunx eslint <files>` (0) + `bun run build` + `bun run test:component` (existing pass).

---

### Task 1: onboarding flag + OnboardingSheet + feed wiring

**Files:** Create `src/lib/onboarding.ts`, `src/lib/components/OnboardingSheet.svelte`; Modify `src/routes/+page.svelte`.

- [ ] **Step 1: flag helper** — `src/lib/onboarding.ts`:

```ts
const KEY = 'brp:onboarded';

/** SSR-safe: returns true during SSR so the overlay never flashes server-side. */
export function isOnboarded(): boolean {
	if (typeof localStorage === 'undefined') return true;
	return localStorage.getItem(KEY) === '1';
}

export function markOnboarded(): void {
	if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, '1');
}
```

- [ ] **Step 2: OnboardingSheet** — `src/lib/components/OnboardingSheet.svelte`:

```svelte
<script lang="ts">
	import { resolve } from '$app/paths';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '$convex/_generated/api';

	let { deviceId, onDone }: { deviceId: string; onDone: () => void } = $props();

	const suggestions = useQuery(api.topics.topByPageviews, () => ({ limit: 18 }));
	const interestsQuery = useQuery(api.interests.list, () => (deviceId ? { deviceId } : 'skip'));
	const followedSlugs = $derived(new Set<string>((interestsQuery.data ?? []).map((i) => i.slug)));
	const addInterest = useMutation(api.interests.add);
	const removeInterest = useMutation(api.interests.remove);

	const display = (title: string) => title.replace(/_/g, ' ');
	function toggle(slug: string, title: string) {
		if (!deviceId) return;
		if (followedSlugs.has(slug)) void removeInterest({ deviceId, slug });
		else void addInterest({ deviceId, slug, title: display(title) });
	}
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-label="Pick your interests">
	<div class="sheet">
		<h1>What are you into?</h1>
		<p class="sub">Pick a few topics to shape your feed — you can change these anytime.</p>
		<div class="chips">
			{#each suggestions.data ?? [] as t (t.slug)}
				<button
					type="button"
					class="chip"
					class:active={followedSlugs.has(t.slug)}
					aria-pressed={followedSlugs.has(t.slug)}
					onclick={() => toggle(t.slug, t.title)}
				>
					{display(t.title)}
				</button>
			{/each}
		</div>
		<button type="button" class="start" onclick={onDone}>Start reading</button>
		<p class="signin">
			<a href={resolve('/account')}>Sign in to save your interests across devices →</a>
		</p>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: var(--bg);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem;
		overflow-y: auto;
	}
	.sheet {
		max-width: 560px;
		width: 100%;
	}
	h1 {
		font-size: 1.5rem;
		margin: 0 0 0.4rem;
	}
	.sub {
		color: var(--muted);
		line-height: 1.5;
		margin: 0 0 1.25rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}
	.chip {
		font: inherit;
		cursor: pointer;
		padding: 0.5rem 0.9rem;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
	}
	.chip.active {
		color: var(--accent);
		border-color: var(--accent);
	}
	.start {
		font: inherit;
		font-weight: 700;
		cursor: pointer;
		width: 100%;
		padding: 0.8rem;
		border-radius: var(--radius);
		border: none;
		background: var(--accent);
		color: var(--bg);
	}
	.signin {
		text-align: center;
		margin: 1rem 0 0;
		font-size: 0.9rem;
	}
	.signin a {
		color: var(--muted);
	}
</style>
```

> Verify in `src/app.css` that `--bg` and `--accent` exist (the feed/account use `--accent`; the body bg token may be `--bg` or `--background` — use whatever the app defines for the page background). If `--bg` isn't defined, use the actual page-background token. The `color: var(--bg)` on `.start` is the on-accent text color — use the app's existing on-accent/background token.

- [ ] **Step 3: feed wiring** — in `src/routes/+page.svelte`:
  - imports: `import OnboardingSheet from '$lib/components/OnboardingSheet.svelte';` and `import { isOnboarded, markOnboarded } from '$lib/onboarding';`
  - state: `let showOnboarding = $state(false);`
  - in the existing `onMount` (where `deviceId = getDeviceId()` runs), after setting deviceId add: `if (!isOnboarded()) showOnboarding = true;`
  - render near the top of the template (before/above the nav is fine — it's a fixed overlay):

```svelte
{#if showOnboarding && deviceId}
	<OnboardingSheet
		{deviceId}
		onDone={() => {
			markOnboarded();
			showOnboarding = false;
		}}
	/>
{/if}
```

- [ ] **Step 4: verify** — `bun run check` (0); `bunx eslint src/lib/onboarding.ts src/lib/components/OnboardingSheet.svelte src/routes/+page.svelte` (0); `bun run build` (succeeds); `bun run test:component` (existing pass).

- [ ] **Step 5: commit** — `git add src/lib/onboarding.ts src/lib/components/OnboardingSheet.svelte src/routes/+page.svelte && git commit -m "feat(onboarding): first-run interest picker"`

---

## Post-implementation (controller)

Deploy + push; browser-test like a human: clear `localStorage['brp:onboarded']`, reload feed → picker appears → tap 2–3 topics (chips activate) → Start reading → dismisses to feed → reload → picker does NOT reappear → picked topics show in /account Interests.

## Coverage boundary

Svelte UI verified by the controller browser test; topByPageviews/interests already unit-tested (SP1/SP3).
