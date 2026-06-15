<script lang="ts">
	// Thumb-zone action bar (ui-ux.md §4). Bottom-right on phone, right rail on
	// desktop (positioned by the parent). Icon buttons with accessible labels and
	// ≥44px targets.
	let {
		saved,
		onSave,
		onNotInterested
	}: {
		saved: boolean;
		onSave: () => void;
		onNotInterested: () => void;
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
		class="action"
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
</div>
