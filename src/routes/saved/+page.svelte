<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { getDeviceId } from '$lib/identity';
	import { formatName, relativeTime } from '$lib/cards';

	let deviceId = $state('');
	onMount(() => {
		deviceId = getDeviceId();
	});

	const saved = useQuery(api.saved.list, () => (deviceId ? { deviceId } : 'skip'));
	const toggleSave = useMutation(api.saved.toggle);

	// Optimistically hide a removed card; the reactive list catches up on the server round-trip.
	const removed = new SvelteSet<string>();
	const items = $derived((saved.data ?? []).filter((c) => !removed.has(c._id)));

	async function remove(cardId: Id<'knowledgeCards'>) {
		removed.add(cardId);
		try {
			await toggleSave({ deviceId, cardId });
		} catch (err) {
			removed.delete(cardId); // restore on failure — never silently drop
			console.error('[saved] remove failed', err);
		}
	}

	function focusHref(tag: string): string {
		return `${resolve('/')}?focus=${encodeURIComponent(tag)}`;
	}
</script>

<svelte:head><title>Saved</title></svelte:head>

<main class="saved">
	<header>
		<a class="back" href={resolve('/')}>← Feed</a>
		<h1>
			Saved {#if items.length}<span class="count">{items.length}</span>{/if}
		</h1>
		<a class="sync-link" href={resolve('/account')}>Account →</a>
	</header>

	{#if saved.error}
		<p class="msg error">{saved.error.message}</p>
	{:else if saved.isLoading}
		<p class="msg">Loading…</p>
	{:else if items.length === 0}
		<div class="empty">
			<div class="empty-mark" aria-hidden="true">🔖</div>
			<h2>Nothing saved yet</h2>
			<p>Tap the bookmark on a card and it lands here — your own collection to revisit.</p>
			<a class="cta" href={resolve('/')}>Back to the feed</a>
		</div>
	{:else}
		<ul>
			{#each items as card (card._id)}
				<li>
					{#if card.image}
						<img class="thumb" src={card.image.thumbnailUrl} alt="" loading="lazy" />
					{/if}
					<div class="meta">
						<span class="fmt">{formatName(card.format)}</span>
						<span class="when">Saved {relativeTime(card.savedAt)}</span>
					</div>
					<h2>{card.hook}</h2>
					<p>{card.body}</p>
					<div class="chips">
						{#each card.conceptTags as tag (tag)}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- focus deep-link with a query string -->
							<a class="chip" href={focusHref(tag)}>{tag}</a>
						{/each}
					</div>
					<div class="row">
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external source link -->
						<a class="src" href={card.source.articleUrl} target="_blank" rel="noreferrer noopener">
							{card.source.articleTitle} — Wikipedia
						</a>
						<button type="button" class="remove" onclick={() => remove(card._id)}>Remove</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.saved {
		max-width: 640px;
		margin: 0 auto;
		padding: calc(env(safe-area-inset-top) + 1.5rem) 1.25rem
			calc(env(safe-area-inset-bottom) + 4rem);
	}
	header {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 1.5rem;
	}
	.back {
		color: var(--muted);
		font-size: 0.9rem;
		text-decoration: none;
		width: fit-content;
	}
	.back:hover {
		color: var(--text);
	}
	h1 {
		margin: 0;
		font-size: 1.4rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.count {
		font-size: 0.85rem;
		font-weight: 650;
		color: var(--accent);
		background: var(--surface-2);
		padding: 0.1rem 0.5rem;
		border-radius: var(--radius-xs);
	}
	.sync-link {
		color: var(--muted);
		font-size: 0.82rem;
		text-decoration: none;
		margin-top: 0.2rem;
	}
	.sync-link:hover {
		color: var(--accent);
	}
	.msg {
		color: var(--muted);
	}
	.empty {
		text-align: center;
		color: var(--muted);
		margin-top: 18vh;
	}
	.empty-mark {
		font-size: 2.5rem;
	}
	.empty h2 {
		margin: 0.6rem 0 0.3rem;
		color: var(--text);
		font-size: 1.2rem;
	}
	.empty p {
		margin: 0 auto 1.2rem;
		max-width: 28ch;
		line-height: 1.5;
	}
	.cta {
		display: inline-block;
		color: var(--text);
		text-decoration: none;
		background: var(--surface-2);
		border: 1px solid var(--border);
		padding: 0.5rem 1rem;
		border-radius: var(--radius-sm);
	}
	.cta:hover {
		border-color: var(--accent);
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	/* Desktop: use the extra width for a two-up grid instead of a long column. */
	@media (min-width: 900px) {
		.saved {
			max-width: 960px;
		}
		ul {
			display: grid;
			grid-template-columns: repeat(2, 1fr);
			align-items: start;
		}
	}
	li {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.1rem;
	}
	.thumb {
		width: 100%;
		height: 140px;
		object-fit: cover;
		border-radius: 8px;
		margin-bottom: 0.85rem;
		background: var(--surface-2);
	}
	.meta {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
	}
	.fmt {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
	}
	.when {
		font-size: 0.72rem;
		color: var(--muted);
	}
	h2 {
		font-size: 1.15rem;
		margin: 0.3rem 0 0.4rem;
	}
	p {
		margin: 0 0 0.7rem;
		color: var(--text-2);
		line-height: 1.5;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.85rem;
	}
	.chip {
		font-size: 0.76rem;
		color: var(--muted);
		text-decoration: none;
		background: var(--surface-2);
		border: 1px solid transparent;
		padding: 0.25rem 0.6rem;
		border-radius: var(--radius-xs);
	}
	/* These are filled tag-chips, not the feed's dot-tags — suppress the global
	   .chip::before dot so they don't read as box-plus-bullet. */
	.chip::before {
		display: none;
	}
	.chip:hover {
		color: var(--text);
		border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		border-top: 1px solid var(--border);
		padding-top: 0.75rem;
	}
	.src {
		color: var(--accent);
		font-size: 0.88rem;
	}
	.remove {
		font: inherit;
		font-size: 0.82rem;
		color: var(--muted);
		background: none;
		border: 1px solid var(--border);
		padding: 0.3rem 0.7rem;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease);
	}
	.remove:hover {
		color: var(--negative);
		border-color: var(--negative);
	}
</style>
