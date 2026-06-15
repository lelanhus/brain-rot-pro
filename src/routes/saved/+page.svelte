<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { useQuery } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import { getDeviceId } from '$lib/identity';
	import { formatName } from '$lib/cards';

	let deviceId = $state('');
	onMount(() => {
		deviceId = getDeviceId();
	});

	const saved = useQuery(api.saved.list, () => (deviceId ? { deviceId } : 'skip'));
	const items = $derived(saved.data ?? []);
</script>

<svelte:head><title>Saved</title></svelte:head>

<main class="saved">
	<header>
		<a href={resolve('/')}>← Feed</a>
		<h1>Saved</h1>
	</header>

	{#if saved.error}
		<p class="msg error">{saved.error.message}</p>
	{:else if saved.isLoading}
		<p class="msg">Loading…</p>
	{:else if items.length === 0}
		<p class="msg">Nothing saved yet. Tap the bookmark on a card to keep it here.</p>
	{:else}
		<ul>
			{#each items as card (card._id)}
				<li>
					<span class="fmt">{formatName(card.format)}</span>
					<h2>{card.hook}</h2>
					<p>{card.body}</p>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external source link -->
					<a class="src" href={card.source.articleUrl} target="_blank" rel="noreferrer noopener">
						{card.source.articleTitle} — Wikipedia
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.saved {
		max-width: 640px;
		margin: 0 auto;
		padding: 1.5rem 1.25rem 4rem;
	}
	header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 1.5rem;
	}
	header a {
		color: var(--muted);
		font-size: 0.9rem;
	}
	h1 {
		margin: 0;
		font-size: 1.4rem;
	}
	.msg {
		color: var(--muted);
	}
	ul {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	li {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.1rem;
	}
	.fmt {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
	}
	h2 {
		font-size: 1.15rem;
		margin: 0.3rem 0 0.4rem;
	}
	p {
		margin: 0 0 0.6rem;
		color: var(--text-2);
		line-height: 1.5;
	}
	.src {
		color: var(--accent);
		font-size: 0.9rem;
	}
</style>
