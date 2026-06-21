<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { useQuery, useMutation } from '@mmailaender/convex-svelte';
	import { api } from '$convex/_generated/api';
	import { adminAuth, isUnauthorized } from '$lib/admin.svelte';

	const deviceId = $derived(page.params.deviceId ?? '');
	const detail = useQuery(api.admin.account, () => ({ token: adminAuth.token, deviceId }));
	const data = $derived(detail.data);
	const unauthorized = $derived(isUnauthorized(detail.error));

	const deleteData = useMutation(api.account.deleteData);
	let confirming = $state(false);
	let deleting = $state(false);

	async function doDelete() {
		deleting = true;
		try {
			await deleteData({ deviceId });
			await goto(resolve('/admin/accounts'));
		} catch (err) {
			console.error('[admin/accounts] delete failed', err);
			deleting = false;
			confirming = false;
		}
	}

	const when = (ts: number) => new Date(ts).toLocaleString();
</script>

<svelte:head><title>Admin · Account</title></svelte:head>

<main class="admin">
	<p class="back"><a href={resolve('/admin/accounts')}>← Accounts</a></p>
	<h1>Account</h1>
	<p class="device">{deviceId}</p>

	{#if unauthorized}
		<p class="msg err">
			Token rejected.
			<button type="button" class="link" onclick={() => adminAuth.clear()}>Re-enter token</button>
		</p>
	{:else if detail.error}
		<p class="msg err">{detail.error.message}</p>
	{:else if detail.isLoading || !data}
		<p class="hint">Loading…</p>
	{:else if !data.found}
		<p class="hint">No data for this device.</p>
	{:else}
		<section class="panel">
			<h2>Streak</h2>
			{#if data.stats}
				<ul class="kv">
					<li><span>Current</span><span>{data.stats.currentStreak}d</span></li>
					<li><span>Longest</span><span>{data.stats.longestStreak}d</span></li>
					<li><span>Days learned</span><span>{data.stats.daysLearned}</span></li>
					<li><span>Last active</span><span>{data.stats.lastActiveDay}</span></li>
				</ul>
			{:else}
				<p class="hint">No streak record.</p>
			{/if}
		</section>

		<section class="panel">
			<h2>Top concepts</h2>
			{#if data.topConcepts.length === 0}
				<p class="hint">No learned concept weights yet.</p>
			{:else}
				<div class="chips">
					{#each data.topConcepts as c (c.concept)}
						<span class="chip">{c.concept} <span class="w">{c.weight.toFixed(1)}</span></span>
					{/each}
				</div>
			{/if}
		</section>

		<section class="panel">
			<h2>Saved ({data.saved.length})</h2>
			{#if data.saved.length === 0}
				<p class="hint">Nothing saved.</p>
			{:else}
				<ul class="list">
					{#each data.saved as s (s.cardId)}
						<li>{s.hook}</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="panel">
			<h2>Recent events</h2>
			{#if data.recentEvents.length === 0}
				<p class="hint">No events.</p>
			{:else}
				<ul class="events">
					{#each data.recentEvents as e, i (i)}
						<li><span class="et">{e.type}</span><span class="ets">{when(e.ts)}</span></li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="panel danger">
			<h2>Danger zone</h2>
			<p class="hint">
				Erase all data for this device (saves, profile, streak, sync codes, events). Irreversible.
			</p>
			{#if confirming}
				<div class="confirm">
					<button type="button" class="del" disabled={deleting} onclick={doDelete}>
						{deleting ? 'Deleting…' : 'Confirm delete'}
					</button>
					<button
						type="button"
						class="cancel"
						disabled={deleting}
						onclick={() => (confirming = false)}
					>
						Cancel
					</button>
				</div>
			{:else}
				<button type="button" class="del" onclick={() => (confirming = true)}
					>Delete account data</button
				>
			{/if}
		</section>
	{/if}
</main>

<style>
	.admin {
		max-width: 760px;
		margin: 0 auto;
		padding: 1.5rem 1.25rem 4rem;
	}
	.back a {
		color: var(--muted);
		font-size: 0.9rem;
	}
	h1 {
		margin: 0.5rem 0 0.2rem;
		font-size: 1.4rem;
	}
	.device {
		margin: 0 0 1.25rem;
		color: var(--muted);
		font-family: var(--font-mono, monospace);
		font-size: 0.85rem;
		word-break: break-all;
	}
	h2 {
		font-size: 1.05rem;
		margin: 0 0 0.75rem;
	}
	.hint {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.msg.err {
		color: var(--negative);
	}
	.link {
		font: inherit;
		color: var(--accent);
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		text-decoration: underline;
	}
	.panel {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.1rem;
		margin-bottom: 1.25rem;
	}
	.kv {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.kv li {
		display: flex;
		justify-content: space-between;
		font-size: 0.9rem;
	}
	.kv span:first-child {
		color: var(--muted);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.chip {
		font-size: 0.8rem;
		background: var(--surface-2);
		border-radius: 999px;
		padding: 0.25rem 0.6rem;
	}
	.chip .w {
		color: var(--muted);
	}
	.list,
	.events {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		font-size: 0.9rem;
	}
	.events li {
		display: flex;
		justify-content: space-between;
		color: var(--text-2);
	}
	.et {
		font-family: var(--font-mono, monospace);
	}
	.ets {
		color: var(--muted);
		font-size: 0.8rem;
	}
	.danger {
		border-color: color-mix(in srgb, var(--negative) 40%, var(--border));
	}
	.confirm {
		display: flex;
		gap: 0.6rem;
	}
	button {
		font: inherit;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		cursor: pointer;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-2);
	}
	.del {
		color: var(--negative);
		border-color: var(--negative);
	}
	.del:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
