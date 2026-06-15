<script lang="ts">
	import type { Doc } from '$convex/_generated/dataModel';
	import { formatName } from '$lib/cards';

	let { card }: { card: Doc<'knowledgeCards'> } = $props();
</script>

<article class="card">
	<span class="tag">{formatName(card.format)}</span>

	<h2 class="hook">{card.hook}</h2>
	<p class="body">{card.body}</p>

	{#if card.whyItMatters}
		<p class="why"><span class="why-label">Why it matters</span>{card.whyItMatters}</p>
	{/if}

	<div class="chips">
		{#each card.conceptTags as tag (tag)}
			<span class="chip">{tag}</span>
		{/each}
	</div>

	<details class="source">
		<summary>Source</summary>
		<blockquote>{card.source.sourceSpan}</blockquote>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external source link, not an internal route -->
		<a href={card.source.articleUrl} target="_blank" rel="noreferrer noopener">
			{card.source.articleTitle} — Wikipedia
		</a>
		<p class="license">Text adapted from Wikipedia (CC BY-SA 4.0), modified.</p>
	</details>
</article>
