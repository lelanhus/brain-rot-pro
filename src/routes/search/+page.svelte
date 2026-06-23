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
	{:else if results.data !== undefined && results.data.length === 0}
		<p class="hint">No topics found for "{q}".</p>
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
		padding: calc(env(safe-area-inset-top) + 1.5rem) 1.25rem
			calc(env(safe-area-inset-bottom) + 4rem);
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
