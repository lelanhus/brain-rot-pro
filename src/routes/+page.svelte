<script lang="ts">
	import Card from '$lib/components/Card.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const feed = $derived(data.feed);

	let sentinel = $state<HTMLDivElement | null>(null);

	// Prefetch the next batch as the sentinel nears the viewport so swipes stay
	// instant (acceptance-criteria.md Phase 0: no spinner between cards).
	$effect(() => {
		const el = sentinel;
		if (!el) return;
		const io = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting && feed.status === 'CanLoadMore') {
					feed.loadMore(6);
				}
			},
			{ rootMargin: '800px' }
		);
		io.observe(el);
		return () => io.disconnect();
	});
</script>

<svelte:head>
	<title>Brain Rot Pro</title>
</svelte:head>

<main class="feed" data-testid="feed">
	{#if feed.error}
		<section class="state error">
			<h2>Something went wrong</h2>
			<p>{feed.error.message}</p>
		</section>
	{:else if feed.isLoading && feed.results.length === 0}
		<section class="state">Loading…</section>
	{:else if feed.results.length === 0}
		<section class="state">
			<h2>No cards yet</h2>
			<p>Seed the library: <code>npx convex run seed:seed</code></p>
		</section>
	{:else}
		{#each feed.results as card (card._id)}
			<Card {card} />
		{/each}
		<div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>
		{#if feed.status === 'LoadingMore'}
			<section class="state subtle">Loading more…</section>
		{/if}
	{/if}
</main>
