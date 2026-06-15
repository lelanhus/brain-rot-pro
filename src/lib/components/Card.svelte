<script lang="ts">
	import type { Doc } from '$convex/_generated/dataModel';
	import { formatName } from '$lib/cards';
	import CardActions from './CardActions.svelte';

	let {
		card,
		saved = false,
		onSave,
		onNotInterested,
		onSource,
		onRelated
	}: {
		card: Doc<'knowledgeCards'>;
		saved?: boolean;
		onSave?: () => void;
		onNotInterested?: () => void;
		onSource?: () => void;
		onRelated?: (tag: string) => void;
	} = $props();
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
			<p class="why"><span class="why-label">Why it matters</span>{card.whyItMatters}</p>
		{/if}

		<div class="chips">
			{#each card.conceptTags as tag (tag)}
				<button type="button" class="chip" onclick={() => onRelated?.(tag)}>{tag}</button>
			{/each}
		</div>

		<details class="source" ontoggle={(e) => e.currentTarget.open && onSource?.()}>
			<summary>Source</summary>
			<blockquote>{card.source.sourceSpan}</blockquote>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external source link, not an internal route -->
			<a href={card.source.articleUrl} target="_blank" rel="noreferrer noopener">
				{card.source.articleTitle} — Wikipedia
			</a>
			<p class="license">Text adapted from Wikipedia (CC BY-SA 4.0), modified.</p>
		</details>
	</div>

	{#if onSave && onNotInterested}
		<CardActions {saved} {onSave} {onNotInterested} />
	{/if}
</article>
