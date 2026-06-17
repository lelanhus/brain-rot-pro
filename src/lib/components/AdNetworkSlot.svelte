<script lang="ts">
	import { onMount } from 'svelte';
	import type { AdNetworkConfig } from '$lib/adNetwork';

	let { config }: { config: AdNetworkConfig } = $props();

	const SCRIPT_ID = 'adsbygoogle-js';

	onMount(() => {
		// Load the network script once, then request a fill for this unit. Wrapped
		// so a blocked/absent script never throws into the feed (fail-soft: a slot
		// that can't fill just renders empty).
		try {
			if (!document.getElementById(SCRIPT_ID)) {
				const s = document.createElement('script');
				s.id = SCRIPT_ID;
				s.async = true;
				s.crossOrigin = 'anonymous';
				s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(config.client)}`;
				document.head.appendChild(s);
			}
			const w = window as unknown as { adsbygoogle?: unknown[] };
			(w.adsbygoogle = w.adsbygoogle || []).push({});
		} catch (err) {
			console.error('[ads] network slot failed to initialize', err);
		}
	});
</script>

<!-- In-feed native unit. Labeled by the network; the dashed frame keeps it
	 visually adjacent-to rather than part-of the knowledge feed (ADR-008). -->
<div class="ad-slot" data-testid="ad-network-slot">
	<span class="ad-label">Sponsored</span>
	<ins
		class="adsbygoogle"
		style="display:block"
		data-ad-format="fluid"
		data-ad-layout-key={config.layoutKey}
		data-ad-client={config.client}
		data-ad-slot={config.slot}
	></ins>
</div>

<style>
	.ad-slot {
		width: 100%;
		max-width: 640px;
		border: 1px dashed color-mix(in srgb, var(--accent) 30%, var(--border));
		border-radius: var(--radius);
		padding: 1.1rem;
		background: color-mix(in srgb, var(--accent) 4%, transparent);
	}

	.ad-label {
		display: block;
		font-size: 0.72rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
		margin-bottom: 0.6rem;
	}
</style>
