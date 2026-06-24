<script lang="ts">
	import type { Doc } from '$convex/_generated/dataModel';
	import { fly } from 'svelte/transition';
	import { onDestroy } from 'svelte';
	import { formatName } from '$lib/cards';

	// Full-bleed image poster (redesign §3). The face shows kicker → hook → teaser
	// → payoff over a layered scrim with ZERO taps; a single tap opens the depth
	// sheet ("page 2"); a double-tap likes. Like/dislike/save/share also live on the
	// page-level rail (CardActions), wired by +page.svelte to the active card.
	let {
		card,
		following = false,
		onLike,
		onFollow,
		onSource,
		onRelated,
		onMore,
		moreLoading = false,
		onExpand
	}: {
		card: Doc<'knowledgeCards'>;
		following?: boolean;
		onLike?: () => void;
		onFollow?: () => void;
		onSource?: () => void;
		onRelated?: (tag: string) => void;
		onMore?: () => void;
		moreLoading?: boolean;
		onExpand?: () => void;
	} = $props();

	// The depth sheet slides up over the lower card; it is position:absolute so it
	// never grows the slot's flow height (snap integrity, redesign global constraint).
	let open = $state(false);
	// Transient heart-burst on a like (double-tap or rail), cleared by a timer.
	let burst = $state(false);
	let burstTimer: ReturnType<typeof setTimeout> | null = null;

	// Honor reduced-motion: skip the heart-burst (its CSS animation is force-disabled
	// under reduced-motion, which would otherwise leave a static full-size heart) and
	// zero the sheet's slide. Read once — the preference rarely flips mid-session.
	const reduceMotion =
		typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const sheetDuration = reduceMotion ? 0 : 200;

	function toggleSheet() {
		if (!open) onExpand?.(); // opening the sheet IS the "go deeper" signal (redesign §5)
		open = !open;
	}

	function like() {
		onLike?.();
		if (reduceMotion) return; // no burst when motion is reduced
		burst = true;
		if (burstTimer) clearTimeout(burstTimer);
		burstTimer = setTimeout(() => (burst = false), 600);
	}

	// Tap vs double-tap disambiguation (redesign §8): a single tap toggles the sheet,
	// a double-tap likes. A short timer holds the single-tap so a double-tap can
	// cancel it — that ~230ms is the cost of keeping single-tap free for open/close.
	const DOUBLE_TAP_MS = 230;
	let tapTimer: ReturnType<typeof setTimeout> | null = null;
	function onFaceActivate() {
		if (tapTimer) {
			clearTimeout(tapTimer);
			tapTimer = null;
			like(); // second tap within the window → like, and DON'T open the sheet
			return;
		}
		tapTimer = setTimeout(() => {
			tapTimer = null;
			toggleSheet();
		}, DOUBLE_TAP_MS);
	}

	const scrim = $derived(card.image?.scrim ?? 'medium');

	onDestroy(() => {
		if (tapTimer) clearTimeout(tapTimer);
		if (burstTimer) clearTimeout(burstTimer);
	});
</script>

<!-- The card-level tap is a pointer convenience; the keyboard-accessible open/close
     control is the .open-depth button in the caption, and Like has its rail button. -->
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
<article class="card" onclick={onFaceActivate} ondblclick={(e) => e.preventDefault()}>
	<div class="card-face" data-scrim={scrim}>
		{#if card.image}
			<!-- Free-licensed Commons asset; attribution lives in the depth sheet (ADR-005). -->
			<img class="face-img" src={card.image.thumbnailUrl} alt={card.hook} loading="lazy" />
		{/if}
		<div class="scrim" aria-hidden="true"></div>
		<div class="scrim-top" aria-hidden="true"></div>

		<div class="face-caption">
			<span class="kicker">{formatName(card.format)}</span>
			<h2 class="hook" title={card.hook}>{card.hook}</h2>
			<p class="teaser">{card.body}</p>
			{#if card.whyItMatters}
				<p class="payoff">{card.whyItMatters}</p>
			{/if}
			<div class="face-foot">
				<span class="page-dots" aria-hidden="true">
					<span class="dot" class:active={!open}></span>
					<span class="dot" class:active={open}></span>
				</span>
				<button
					type="button"
					class="open-depth"
					aria-expanded={open}
					onclick={(e) => {
						e.stopPropagation();
						toggleSheet();
					}}
				>
					{open ? 'Close' : 'Tap to read'}
				</button>
			</div>
		</div>

		{#if burst}
			<span class="heart-burst" aria-hidden="true">♥</span>
		{/if}
	</div>

	{#if open}
		<!-- Taps inside the sheet must not bubble to the card's open/close handler. -->
		<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
		<section
			class="depth-sheet"
			transition:fly={{ y: 24, duration: sheetDuration }}
			onclick={(e) => e.stopPropagation()}
		>
			<button
				type="button"
				class="sheet-grip"
				aria-label="Close details"
				onclick={() => (open = false)}
			></button>

			<p class="body-full">{card.body}</p>

			<div class="topic-row">
				<span class="topic-name">{card.source.articleTitle}</span>
				<button
					type="button"
					class="follow"
					class:active={following}
					aria-pressed={following}
					onclick={onFollow}
				>
					{following ? 'Following' : '＋ Follow'}
				</button>
			</div>

			{#if card.conceptTags.length > 0}
				<div class="chips">
					{#each card.conceptTags as tag (tag)}
						<button type="button" class="chip" onclick={() => onRelated?.(tag)}>{tag}</button>
					{/each}
				</div>
			{/if}

			{#if onMore}
				<button type="button" class="more" onclick={onMore} disabled={moreLoading}>
					{moreLoading ? 'Finding…' : 'More like this →'}
				</button>
			{/if}

			<div class="source">
				<blockquote>{card.source.sourceSpan}</blockquote>
				<!-- eslint-disable svelte/no-navigation-without-resolve -- external source link, not an internal route -->
				<a
					href={card.source.articleUrl}
					target="_blank"
					rel="noreferrer noopener"
					onclick={onSource}
				>
					{card.source.articleTitle} — Wikipedia
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
				<p class="license">Text adapted from Wikipedia (CC BY-SA 4.0), modified.</p>
			</div>
		</section>
	{/if}
</article>
