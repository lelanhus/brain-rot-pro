<script lang="ts">
	// Thumb-zone action bar (ui-ux.md §4). Bottom-right on phone, right rail on
	// desktop (positioned by the parent). Icon buttons with accessible labels and
	// ≥44px targets.
	let {
		saved,
		onSave,
		onNotInterested,
		onShare
	}: {
		saved: boolean;
		onSave: () => void;
		onNotInterested: () => void;
		onShare?: () => void;
	} = $props();
</script>

<div class="actions">
	<button
		type="button"
		class="action"
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

	<button
		type="button"
		class="action dismiss"
		aria-label="Not interested"
		title="Not interested"
		onclick={onNotInterested}
	>
		<svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
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
