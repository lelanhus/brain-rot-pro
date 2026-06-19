<script lang="ts">
	import { onMount } from 'svelte';
	import type { SponsoredOffer } from '$lib/sponsored';

	let {
		offer,
		onImpression,
		onClick,
		onDismiss
	}: {
		offer: SponsoredOffer;
		onImpression?: () => void;
		onClick?: () => void;
		onDismiss?: () => void;
	} = $props();

	// Fire one impression when the slot mounts (it only mounts once it's woven
	// into the rendered feed near the viewport). Kept simple and reliable rather
	// than IO-gated — slot density is low so over-counting is negligible.
	onMount(() => onImpression?.());
</script>

<article class="card sponsored" data-testid="sponsored-card">
	{#if offer.imageUrl}
		<figure class="card-image">
			<img src={offer.imageUrl} alt={offer.headline} loading="lazy" />
		</figure>
	{/if}
	<div class="card-body">
		<span class="tag sponsored-tag">Sponsored · Go deeper</span>

		<h2 class="hook">{offer.headline}</h2>
		<p class="body">{offer.blurb}</p>

		<!-- eslint-disable svelte/no-navigation-without-resolve -- external affiliate link, not an internal route -->
		<a
			class="cta"
			href={offer.url}
			target="_blank"
			rel="sponsored nofollow noopener noreferrer"
			onclick={() => onClick?.()}
		>
			{offer.cta} →
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->

		<p class="disclosure">{offer.disclosure}</p>
	</div>

	{#if onDismiss}
		<button
			type="button"
			class="dismiss"
			aria-label="Not interested"
			title="Not interested"
			onclick={onDismiss}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
				<path
					d="M6 6l12 12M18 6L6 18"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
				/>
			</svg>
			<span class="vh">Not interested</span>
		</button>
	{/if}
</article>

<style>
	/* A faint tint + border so the slot reads as adjacent-to, not part-of, the
	   knowledge feed — native in shape, honest in labeling (ADR-008). */
	.sponsored {
		position: relative;
		border: 1px dashed color-mix(in srgb, var(--accent) 30%, var(--border));
		border-radius: var(--radius);
		padding: 1.1rem 1.1rem 1.25rem;
		background: color-mix(in srgb, var(--accent) 4%, transparent);
	}

	.sponsored-tag {
		color: var(--muted);
	}

	.cta {
		align-self: flex-start;
		font-size: 0.9rem;
		font-weight: 650;
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
		padding: 0.5rem 0.95rem;
		border-radius: var(--radius-sm);
		text-decoration: none;
		transition: background var(--dur-fast) var(--ease);
	}

	.cta:hover {
		background: color-mix(in srgb, var(--accent) 24%, transparent);
	}

	.disclosure {
		margin: 0;
		font-size: 0.72rem;
		color: var(--muted);
	}

	.dismiss {
		position: absolute;
		top: 0.6rem;
		right: 0.6rem;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		color: var(--muted);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.dismiss:hover {
		color: var(--text);
	}

	.vh {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
