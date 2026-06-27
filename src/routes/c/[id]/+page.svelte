<script lang="ts">
	import { onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import Card from '$lib/components/Card.svelte';
	import { shareCard } from '$lib/share';

	let { data } = $props();
	// convexLoad returns a DetachedQueryResult ({ data }); null when caught/not found.
	const card = $derived(data.card?.data ?? null);

	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | null = null;
	async function onShare() {
		if (!card) return;
		const r = await shareCard(card._id, card.hook);
		if (r === 'copied') {
			copied = true;
			if (copiedTimer) clearTimeout(copiedTimer);
			copiedTimer = setTimeout(() => (copied = false), 1500);
		} else if (r === 'failed') {
			console.error('[share] failed');
		}
	}
	onDestroy(() => {
		if (copiedTimer) clearTimeout(copiedTimer);
	});

	// OG/Twitter metadata, rendered at SSR so shared links unfurl with a rich preview.
	const title = $derived(card ? card.hook : 'Wonderwell');
	const description = $derived(
		card
			? card.body.slice(0, 200)
			: 'Surprising, source-backed sparks of wonder. One more idea, always.'
	);
	const ogImage = $derived(card?.image?.thumbnailUrl);
	const canonical = $derived(card ? `${data.origin}/c/${card._id}` : data.origin);
</script>

<svelte:head>
	<title>{title} · Wonderwell</title>
	<meta name="description" content={description} />
	<meta property="og:type" content="article" />
	<meta property="og:site_name" content="Wonderwell" />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />
	<link rel="canonical" href={canonical} />
	{#if ogImage}<meta property="og:image" content={ogImage} />{/if}
	<meta name="twitter:card" content={ogImage ? 'summary_large_image' : 'summary'} />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	{#if ogImage}<meta name="twitter:image" content={ogImage} />{/if}
</svelte:head>

<main class="share-page">
	<header class="share-head">
		<a class="back" href={resolve('/')}>Wonderwell</a>
		{#if card}
			<button
				type="button"
				class="share-btn"
				onclick={onShare}
				aria-label={copied ? 'Link copied' : 'Share'}
			>
				{#if copied}
					<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
						<path
							d="M5 13l4 4L19 7"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					Copied
				{:else}
					<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
						<path
							d="M12 15V4M12 4 8.5 7.5M12 4l3.5 3.5M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					Share
				{/if}
			</button>
		{/if}
	</header>

	{#if card}
		<Card {card} />
		<a class="cta" href={resolve('/')}>Open the feed →</a>
	{:else}
		<div class="missing">
			<h1>This card isn't available</h1>
			<p>It may have been removed, or the link is incomplete.</p>
			<a class="cta" href={resolve('/')}>Go to the feed →</a>
		</div>
	{/if}
</main>

<style>
	.share-page {
		max-width: 640px;
		margin: 0 auto;
		padding: calc(env(safe-area-inset-top) + var(--space-5)) var(--space-5)
			calc(env(safe-area-inset-bottom) + var(--space-8));
	}
	.share-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-6);
	}
	.back {
		font-size: var(--fs-tag);
		font-weight: 700;
		letter-spacing: var(--tracking-tag);
		text-transform: uppercase;
		color: var(--accent);
		text-decoration: none;
	}
	.share-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 40px;
		padding: 0 var(--space-4);
		font: inherit;
		font-size: var(--fs-meta);
		font-weight: 600;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease),
			transform var(--dur-fast) var(--ease-spring);
	}
	.share-btn:hover {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
	}
	.share-btn:active {
		transform: scale(0.96);
	}
	.cta {
		display: inline-block;
		margin-top: var(--space-7);
		font-size: var(--fs-meta);
		font-weight: 600;
		color: var(--accent);
		text-decoration: none;
	}
	.cta:hover {
		opacity: 0.78;
	}
	.missing {
		text-align: center;
		margin-top: 18vh;
		color: var(--muted);
	}
	.missing h1 {
		font-size: var(--fs-hook);
		color: var(--text);
		margin: 0 0 var(--space-3);
	}
</style>
