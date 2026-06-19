<script lang="ts">
	import type { Doc } from '$convex/_generated/dataModel';
	import { slide } from 'svelte/transition';
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

	// "Why it matters" is significance, not the payload — it competes with the
	// hook (ui-ux.md §3), so the glanceable card hides it behind this toggle and
	// reveals it on demand (the long-defined `card_expand` signal).
	let expanded = $state(false);
	function toggleWhy() {
		if (!expanded) onExpand?.(); // count the first reveal as a deepening signal
		expanded = !expanded;
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
				class:open={expanded}
				aria-expanded={expanded}
				onclick={toggleWhy}
			>
				Why it matters
				<span class="why-caret" aria-hidden="true"></span>
			</button>
			{#if expanded}
				<p class="why" transition:slide={{ duration: 180 }}>{card.whyItMatters}</p>
			{/if}
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

		<details class="source" ontoggle={(e) => e.currentTarget.open && onSource?.()}>
			<summary>
				Source
				<span class="why-caret" aria-hidden="true"></span>
			</summary>
			<blockquote>{card.source.sourceSpan}</blockquote>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external source link, not an internal route -->
			<a href={card.source.articleUrl} target="_blank" rel="noreferrer noopener">
				{card.source.articleTitle} — Wikipedia
			</a>
			<p class="license">Text adapted from Wikipedia (CC BY-SA 4.0), modified.</p>
		</details>
	</div>
</article>
