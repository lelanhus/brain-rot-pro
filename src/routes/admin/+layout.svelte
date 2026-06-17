<script lang="ts">
	import { resolve } from '$app/paths';
	import { adminAuth } from '$lib/admin.svelte';

	// Gate for every /admin/* page (offers today; account management + analytics
	// to come). Client-side it just collects the shared secret; the server
	// enforces it (assertAdmin) on each call, so this is UX, not the security
	// boundary. A rejected token is surfaced by the child page and cleared here.
	let { children } = $props();

	let entry = $state('');
	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (entry.trim().length === 0) return;
		adminAuth.set(entry);
		entry = '';
	}
</script>

{#if adminAuth.hasToken}
	<div class="admin-bar">
		<a href={resolve('/')}>← Feed</a>
		<button type="button" class="signout" onclick={() => adminAuth.clear()}>Sign out</button>
	</div>
	{@render children()}
{:else}
	<main class="gate">
		<h1>Admin</h1>
		<p>Enter the admin token to continue.</p>
		<form onsubmit={submit}>
			<input
				type="password"
				bind:value={entry}
				placeholder="Admin token"
				autocomplete="off"
				aria-label="Admin token"
			/>
			<button type="submit" class="primary">Continue</button>
		</form>
	</main>
{/if}

<style>
	.admin-bar {
		max-width: 760px;
		margin: 0 auto;
		padding: 1rem 1.25rem 0;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.admin-bar a {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.signout {
		font: inherit;
		font-size: 0.85rem;
		color: var(--muted);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.3rem 0.7rem;
		cursor: pointer;
	}
	.gate {
		max-width: 360px;
		margin: 0 auto;
		padding: 4rem 1.25rem;
	}
	.gate h1 {
		margin: 0 0 0.25rem;
		font-size: 1.4rem;
	}
	.gate p {
		color: var(--muted);
		margin: 0 0 1.25rem;
	}
	.gate form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	input {
		font: inherit;
		padding: 0.55rem 0.7rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
	}
	.primary {
		font: inherit;
		font-weight: 600;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		cursor: pointer;
		background: var(--accent);
		color: #06281c;
		border: 1px solid var(--accent);
	}
</style>
