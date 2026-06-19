<script lang="ts">
	import { themeStore, type Theme } from '$lib/theme.svelte';

	const options: { value: Theme; label: string }[] = [
		{ value: 'system', label: 'System' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' }
	];
</script>

<div class="theme" role="group" aria-label="Theme">
	{#each options as opt (opt.value)}
		<button
			type="button"
			class="opt"
			class:active={themeStore.value === opt.value}
			aria-pressed={themeStore.value === opt.value}
			onclick={() => themeStore.set(opt.value)}
		>
			{opt.label}
		</button>
	{/each}
</div>

<style>
	.theme {
		display: inline-flex;
		gap: 0.25rem;
		background: var(--surface-2);
		border-radius: var(--radius-sm);
		padding: 0.25rem;
	}
	.opt {
		font: inherit;
		font-size: 0.85rem;
		color: var(--muted);
		background: transparent;
		border: none;
		border-radius: var(--radius-xs);
		padding: 0.35rem 0.85rem;
		cursor: pointer;
		transition: color var(--dur-fast) var(--ease);
	}
	.opt.active {
		color: var(--text);
		background: var(--surface);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
	}
</style>
