<script lang="ts">
	import type { Doc } from '$convex/_generated/dataModel';
	import { fade } from 'svelte/transition';
	import { formatName } from '$lib/cards';

	// Card is pure content. Save/dismiss live in a single viewport-fixed action
	// bar (rendered by the feed page, wired to the active card) so the controls
	// sit in the same thumb-zone spot on every screen size — see +page.svelte.
	let {
		card,
		onSource,
		onRelated,
		onMore,
		moreLoading = false,
		onExpand
	}: {
		card: Doc<'knowledgeCards'>;
		onSource?: () => void;
		onRelated?: (tag: string) => void;
		onMore?: () => void;
		moreLoading?: boolean;
		onExpand?: () => void;
	} = $props();

	// "Why it matters" and "Source" each open a non-scrolling overlay anchored to
	// the card. Only one panel is open at a time; `reveal` tracks which (or null).
	// Overlays avoid flow-height changes that would break the slot's overflow:hidden.
	let reveal = $state<'why' | 'source' | null>(null);
	function toggleWhy() {
		if (reveal !== 'why') onExpand?.(); // count the first reveal as a deepening signal
		reveal = reveal === 'why' ? null : 'why';
	}
	function toggleSource() {
		if (reveal !== 'source') onSource?.(); // fire once when source is first opened
		reveal = reveal === 'source' ? null : 'source';
	}
</script>

<article class="card">
	{#if card.image}
		<figure class="card-image">
			<!-- Free-licensed Commons asset; attribution is shown below (ADR-005). -->
			<img src={card.image.thumbnailUrl} alt={card.hook} loading="lazy" />
			<figcaption>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external Commons link -->
				<a href={card.image.commonsUrl} target="_blank" rel="noreferrer noopener"
					>{card.image.author}</a
				>
				·
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external license deed -->
				<a href={card.image.licenseUrl} target="_blank" rel="noreferrer noopener"
					>{card.image.licenseShortName}</a
				>
			</figcaption>
		</figure>
	{/if}
	<div class="card-body">
		<span class="tag">{formatName(card.format)}</span>

		<h2 class="hook">{card.hook}</h2>
		<p class="body">{card.body}</p>

		{#if card.whyItMatters}
			<button
				type="button"
				class="why-toggle"
				class:open={reveal === 'why'}
				aria-expanded={reveal === 'why'}
				onclick={toggleWhy}
			>
				Why it matters
				<span class="why-caret" aria-hidden="true"></span>
			</button>
		{/if}

		<div class="chips">
			{#each card.conceptTags as tag (tag)}
				<button type="button" class="chip" onclick={() => onRelated?.(tag)}>{tag}</button>
			{/each}
		</div>

		{#if onMore}
			<button type="button" class="more" onclick={onMore} disabled={moreLoading}>
				{moreLoading ? 'Finding…' : 'More like this →'}
			</button>
		{/if}

		<button
			type="button"
			class="why-toggle source-toggle"
			class:open={reveal === 'source'}
			aria-expanded={reveal === 'source'}
			onclick={toggleSource}
		>
			Source
			<span class="why-caret" aria-hidden="true"></span>
		</button>
	</div>
	<!-- Overlay: floats over the lower card area so opening it never changes the
	     card's flow height (the slot's overflow:hidden stays undisturbed). -->
	{#if reveal !== null}
		<div class="reveal-overlay" transition:fade={{ duration: 140 }}>
			<button type="button" class="reveal-close" onclick={() => (reveal = null)} aria-label="Close"
				>×</button
			>
			{#if reveal === 'why'}
				<p class="why">{card.whyItMatters}</p>
			{:else}
				<blockquote>{card.source.sourceSpan}</blockquote>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external source link, not an internal route -->
				<a href={card.source.articleUrl} target="_blank" rel="noreferrer noopener">
					{card.source.articleTitle} — Wikipedia
				</a>
				<p class="license">Text adapted from Wikipedia (CC BY-SA 4.0), modified.</p>
			{/if}
		</div>
	{/if}
</article>
