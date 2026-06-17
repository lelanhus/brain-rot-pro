<script lang="ts">
	import { resolve } from '$app/paths';
	import { useQuery } from 'convex-svelte';
	import { ConvexError } from 'convex/values';
	import { api } from '$convex/_generated/api';
	import { adminAuth } from '$lib/admin.svelte';

	// Account management (ADR-009 phase 2) — one row per anonymous device account.
	const accounts = useQuery(api.admin.accounts, () => ({ token: adminAuth.token }));
	const unauthorized = $derived(
		accounts.error instanceof ConvexError &&
			(accounts.error.data as { code?: string })?.code === 'unauthorized'
	);

	let search = $state('');
	const rows = $derived(
		(accounts.data ?? []).filter((r) => search.trim() === '' || r.deviceId.includes(search.trim()))
	);
	const num = (n: number) => n.toLocaleString();
	const short = (id: string) => (id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);
</script>

<svelte:head><title>Admin · Accounts</title></svelte:head>

<main class="admin">
	<h1>Accounts</h1>

	{#if unauthorized}
		<p class="msg err">
			Token rejected.
			<button type="button" class="link" onclick={() => adminAuth.clear()}>Re-enter token</button>
		</p>
	{:else if accounts.error}
		<p class="msg err">{accounts.error.message}</p>
	{:else if accounts.isLoading}
		<p class="hint">Loading…</p>
	{:else}
		<input class="search" bind:value={search} placeholder="Filter by device id…" />
		{#if rows.length === 0}
			<p class="hint">No accounts.</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th>Device</th>
						<th class="num">Streak</th>
						<th class="num">Best</th>
						<th class="num">Days</th>
						<th class="num">Saves</th>
						<th class="num">Concepts</th>
						<th>Last active</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.deviceId)}
						<tr>
							<td>
								<a href={resolve('/admin/accounts/[deviceId]', { deviceId: r.deviceId })}>
									{short(r.deviceId)}
								</a>
							</td>
							<td class="num">{num(r.currentStreak)}</td>
							<td class="num">{num(r.longestStreak)}</td>
							<td class="num">{num(r.daysLearned)}</td>
							<td class="num">{num(r.saves)}</td>
							<td class="num">{num(r.concepts)}</td>
							<td>{r.lastActiveDay || '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="hint small">{num(rows.length)} account{rows.length === 1 ? '' : 's'}</p>
		{/if}
	{/if}
</main>

<style>
	.admin {
		max-width: 760px;
		margin: 0 auto;
		padding: 1.5rem 1.25rem 4rem;
	}
	h1 {
		margin: 0 0 1.25rem;
		font-size: 1.4rem;
	}
	.hint {
		color: var(--muted);
	}
	.small {
		font-size: 0.75rem;
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
	.search {
		font: inherit;
		width: 100%;
		padding: 0.55rem 0.7rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		margin-bottom: 1rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.88rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.5rem 0.4rem;
		border-bottom: 1px solid var(--border);
	}
	th.num,
	td.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	td a {
		color: var(--accent);
		font-family: var(--font-mono, monospace);
	}
</style>
