# Topic Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A `/search` route to find catalog topics and follow them; reached from an "Explore" nav pill on the feed.

**Architecture:** Frontend-only. `/search` does live typeahead over `api.topics.search` and follows results via `api.interests.add/remove` (both exist). No new Convex functions.

**Tech Stack:** SvelteKit/Svelte 5 runes, convex-svelte.

## Global Constraints
- Reuse `api.topics.search({query,limit})` and `api.interests.{add,remove,list}`. No new backend.
- convex-svelte getter-args + `'skip'` pattern; `deviceId` from `getDeviceId` (onMount), guard mutations on it.
- Display titles with underscores replaced by spaces; store the spaced title in `interests` (slug stays the catalog slug). Follow state from `interests.list` by slug.
- Styling reuses existing CSS tokens (`--border`,`--surface`,`--text`,`--muted`,`--accent`,`--radius`); no magic pixel values. YAGNI: no drill-in view.
- Verify: `bun run check` (0) + `bunx eslint <files>` (0) + `bun run build` + `bun run test:component` (existing pass).

---

### Task 1: `/search` route + Explore nav pill

**Files:** Create `src/routes/search/+page.svelte`; Modify `src/routes/+page.svelte` (nav).

- [ ] **Step 1: create the route** — `src/routes/search/+page.svelte`:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import { getDeviceId } from '$lib/identity';

	let deviceId = $state('');
	onMount(() => {
		deviceId = getDeviceId();
	});

	let q = $state('');
	const results = useQuery(api.topics.search, () =>
		q.trim().length >= 2 ? { query: q.trim(), limit: 20 } : 'skip'
	);

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

<svelte:head><title>Explore</title></svelte:head>

<main class="search">
	<header>
		<a class="back" href={resolve('/')}>← Feed</a>
		<h1>Explore topics</h1>
	</header>
	<input
		class="q"
		type="search"
		placeholder="Search topics…"
		bind:value={q}
		aria-label="Search topics"
	/>
	{#if q.trim().length < 2}
		<p class="hint">Type at least 2 characters to search.</p>
	{:else if (results.data ?? []).length === 0}
		<p class="hint">No topics found for “{q}”.</p>
	{:else}
		<ul class="results">
			{#each results.data ?? [] as t (t.slug)}
				<li>
					<span>{display(t.title)}</span>
					<button
						type="button"
						class="ghost"
						class:active={followedSlugs.has(t.slug)}
						aria-pressed={followedSlugs.has(t.slug)}
						onclick={() => toggle(t.slug, t.title)}
					>
						{followedSlugs.has(t.slug) ? 'Following' : 'Follow'}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.search {
		max-width: 560px;
		margin: 0 auto;
		padding: calc(env(safe-area-inset-top) + 1.5rem) 1.25rem calc(env(safe-area-inset-bottom) + 4rem);
	}
	.back {
		color: var(--muted);
		font-size: 0.9rem;
		text-decoration: none;
	}
	h1 {
		margin: 0.35rem 0 1rem;
		font-size: 1.4rem;
	}
	.q {
		width: 100%;
		padding: 0.7rem 0.9rem;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	.hint {
		color: var(--muted);
		margin-top: 1rem;
		font-size: 0.92rem;
	}
	.results {
		list-style: none;
		padding: 0;
		margin: 1rem 0 0;
	}
	.results li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.6rem 0;
		border-bottom: 1px solid var(--border);
	}
	.ghost {
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		border-radius: var(--radius-sm);
		padding: 0.4rem 0.9rem;
		color: var(--text);
		background: transparent;
		border: 1px solid var(--border);
	}
	.ghost.active {
		color: var(--accent);
		border-color: var(--accent);
	}
</style>
```

- [ ] **Step 2: add the Explore nav pill** — in `src/routes/+page.svelte`, the `.feed-nav` block (~line 380) currently has Saved + Account pills. Add Explore as the first pill:

```svelte
<nav class="feed-nav">
	<a class="nav-pill" href={resolve('/search')}>Explore</a>
	<a class="nav-pill" href={resolve('/saved')}>Saved</a>
	<a class="nav-pill" href={resolve('/account')}>Account</a>
</nav>
```

(Match the exact existing markup; only insert the new `<a>` — don't restructure the others.)

- [ ] **Step 3: verify** — `bun run check` (0 errors); `bunx eslint src/routes/search/+page.svelte src/routes/+page.svelte` (0); `bun run build` (succeeds); `bun run test:component` (existing pass). Confirm `--radius-sm` exists in the app's CSS tokens (used by other buttons, e.g. account page); if not, use `--radius`.

- [ ] **Step 4: commit** — `git add src/routes/search src/routes/+page.svelte && git commit -m "feat(search): /search route to find + follow catalog topics"`

---

## Post-implementation (controller)
Deploy + push; browser-test like a human: tap Explore → type a query (e.g. "Cleopatra") → see results → Follow one → confirm Following state + that it appears in /account Interests.

## Coverage boundary
Svelte UI verified by the controller browser test (project pattern); the underlying search/interests logic is already unit-tested in SP1/SP3.
