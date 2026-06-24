<script lang="ts">
	// Bottom-right thumb-zone rail (redesign §4–5): like · dislike · save · share —
	// the explicit, accessible mirrors of the double-tap-like gesture. Follow moved
	// into the depth sheet (it's low-frequency). Positioned by the parent (fixed),
	// so the controls sit in the same spot on every screen size. ≥44px targets.
	let {
		liked,
		onLike,
		disliked,
		onDislike,
		saved,
		onSave,
		onShare
	}: {
		liked: boolean;
		onLike: () => void;
		disliked: boolean;
		onDislike: () => void;
		saved: boolean;
		onSave: () => void;
		onShare?: () => void;
	} = $props();
</script>

<div class="actions">
	<button
		type="button"
		class="action like"
		class:active={liked}
		aria-pressed={liked}
		aria-label={liked ? 'Liked — tap to remove' : 'Like'}
		title={liked ? 'Liked' : 'Like'}
		onclick={onLike}
	>
		<svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
			<path
				d="M12 21s-7-4.35-9.5-8.5C1 9 3 5 6.5 5 9 5 12 8 12 8s3-3 5.5-3C21 5 23 9 21.5 12.5 19 16.65 12 21 12 21z"
				fill={liked ? 'currentColor' : 'none'}
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linejoin="round"
			/>
		</svg>
		<span class="vh">{liked ? 'Liked' : 'Like'}</span>
	</button>

	<button
		type="button"
		class="action dislike"
		class:active={disliked}
		aria-pressed={disliked}
		aria-label="Not interested"
		title="Not interested"
		onclick={onDislike}
	>
		<svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
			<path
				d="M10 15v4a2 2 0 0 0 2 2l3-7V3H6.5a2 2 0 0 0-2 1.7l-1.4 9A2 2 0 0 0 5 16h5zM18 3h2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-2"
				fill={disliked ? 'currentColor' : 'none'}
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linejoin="round"
			/>
		</svg>
		<span class="vh">Not interested</span>
	</button>

	<button
		type="button"
		class="action save"
		class:active={saved}
		aria-pressed={saved}
		aria-label={saved ? 'Saved — tap to remove' : 'Save'}
		title={saved ? 'Saved' : 'Save'}
		onclick={onSave}
	>
		<svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
			<path
				d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"
				fill={saved ? 'currentColor' : 'none'}
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linejoin="round"
			/>
		</svg>
		<span class="vh">{saved ? 'Saved' : 'Save'}</span>
	</button>

	{#if onShare}
		<button type="button" class="action share" aria-label="Share" title="Share" onclick={onShare}>
			<svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
				<path
					d="M12 15V4M12 4 8.5 7.5M12 4l3.5 3.5M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			<span class="vh">Share</span>
		</button>
	{/if}
</div>
