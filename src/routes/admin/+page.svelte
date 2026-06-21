<script lang="ts">
	import { useQuery } from '@mmailaender/convex-svelte';
	import { api } from '$convex/_generated/api';
	import { adminAuth, isUnauthorized } from '$lib/admin.svelte';

	// Analytics overview (ADR-009) — one gated read folded into a dashboard.
	const overview = useQuery(api.admin.overview, () => ({ token: adminAuth.token }));
	const data = $derived(overview.data);
	const unauthorized = $derived(isUnauthorized(overview.error));

	const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
	const num = (n: number) => n.toLocaleString();
	// Peak impressions across the activity window, for bar scaling (min 1).
	const activityPeak = $derived(Math.max(1, ...(data?.activity ?? []).map((d) => d.impressions)));

	// Card lifecycle statuses in pipeline order, for a stable display.
	const STATUSES = [
		'draft',
		'needs_review',
		'validation_failed',
		'approved',
		'published',
		'suppressed'
	];
</script>

<svelte:head><title>Admin · Overview</title></svelte:head>

<main class="admin">
	<h1>Overview</h1>

	{#if unauthorized}
		<p class="msg err">
			Token rejected.
			<button type="button" class="link" onclick={() => adminAuth.clear()}>Re-enter token</button>
		</p>
	{:else if overview.error}
		<p class="msg err">{overview.error.message}</p>
	{:else if overview.isLoading || !data}
		<p class="hint">Loading…</p>
	{:else}
		<section class="cards">
			<div class="stat">
				<span class="label">Active today</span>
				<span class="value">{num(data.audience.activeToday)}</span>
				<span class="sub">{num(data.audience.devices)} devices total</span>
			</div>
			<div class="stat">
				<span class="label">CCR</span>
				<span class="value">{pct(data.engagement.ccr)}</span>
				<span class="sub">{num(data.engagement.impressions)} impressions</span>
			</div>
			<div class="stat">
				<span class="label">Saves</span>
				<span class="value">{num(data.audience.saves)}</span>
				<span class="sub">max streak {num(data.audience.maxStreak)}d</span>
			</div>
			<div class="stat">
				<span class="label">Published cards</span>
				<span class="value">{num(data.content.published)}</span>
				<span class="sub"
					>of {num(data.content.cardsTotal)} · {num(data.content.sourceArticles)} sources</span
				>
			</div>
			<div class="stat">
				<span class="label">Ad CTR</span>
				<span class="value">{pct(data.monetization.ctr)}</span>
				<span class="sub"
					>{num(data.monetization.clicks)}/{num(data.monetization.impressions)} clicks</span
				>
			</div>
			<div class="stat">
				<span class="label">Events</span>
				<span class="value">{num(data.engagement.totalEvents)}</span>
				<span class="sub">{num(data.engagement.continuations)} continuations</span>
			</div>
		</section>

		<section class="panel">
			<h2>Content pipeline</h2>
			<ul class="pipeline">
				{#each STATUSES as status (status)}
					<li>
						<span class="pl-label">{status.replace('_', ' ')}</span>
						<span class="pl-count">{num(data.content.byStatus[status] ?? 0)}</span>
					</li>
				{/each}
			</ul>
		</section>

		<section class="panel">
			<h2>Activity · last 14 days</h2>
			<ul class="bars">
				{#each data.activity as d (d.day)}
					<li>
						<span class="bar-day">{d.day.slice(5)}</span>
						<span class="bar-track">
							<span class="bar-fill" style="width: {(d.impressions / activityPeak) * 100}%"></span>
						</span>
						<span class="bar-val">{num(d.impressions)} · {num(d.continuations)}</span>
					</li>
				{/each}
			</ul>
			<p class="hint small">impressions · continuations</p>
		</section>

		<section class="panel">
			<h2>Events by type</h2>
			<ul class="pipeline">
				{#each Object.entries(data.engagement.byType).sort((a, b) => b[1] - a[1]) as [type, count] (type)}
					<li>
						<span class="pl-label">{type.replace(/_/g, ' ')}</span>
						<span class="pl-count">{num(count)}</span>
					</li>
				{/each}
			</ul>
		</section>
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
	h2 {
		font-size: 1.05rem;
		margin: 0 0 0.75rem;
	}
	.hint {
		color: var(--muted);
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
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.9rem 1rem;
	}
	.label {
		font-size: 0.72rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.value {
		font-size: 1.6rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.sub {
		font-size: 0.78rem;
		color: var(--muted);
	}
	.panel {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.1rem;
		margin-bottom: 1.25rem;
	}
	.pipeline {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.pipeline li {
		display: flex;
		justify-content: space-between;
		font-size: 0.9rem;
		padding: 0.3rem 0;
		border-bottom: 1px solid var(--border);
	}
	.pl-label {
		color: var(--text-2);
		text-transform: capitalize;
	}
	.pl-count {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.small {
		font-size: 0.75rem;
		margin: 0.5rem 0 0;
	}
	.bars {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.bars li {
		display: grid;
		grid-template-columns: 3rem 1fr auto;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.8rem;
	}
	.bar-day {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.bar-track {
		background: var(--surface-2);
		border-radius: 999px;
		height: 0.5rem;
		overflow: hidden;
	}
	.bar-fill {
		display: block;
		height: 100%;
		background: var(--accent);
		border-radius: 999px;
		min-width: 2px;
	}
	.bar-val {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
</style>
