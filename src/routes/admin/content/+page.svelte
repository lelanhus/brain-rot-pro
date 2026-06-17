<script lang="ts">
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { adminAuth, isUnauthorized } from '$lib/admin.svelte';

	// Content management (ADR-009 phase 3): browse/search cards by status and
	// moderate them. Defaults to the needs_review queue, so it also serves as the
	// gated review surface (the legacy /review + CLI still exist for now).
	type Status =
		| 'draft'
		| 'needs_review'
		| 'validation_failed'
		| 'approved'
		| 'published'
		| 'suppressed';
	const STATUSES: Status[] = [
		'needs_review',
		'published',
		'suppressed',
		'draft',
		'approved',
		'validation_failed'
	];

	let status = $state<Status>('needs_review');
	let search = $state('');

	const cards = useQuery(api.admin.cards, () => ({
		token: adminAuth.token,
		status,
		search: search.trim() || undefined
	}));
	const unauthorized = $derived(isUnauthorized(cards.error));
	const rows = $derived(cards.data ?? []);

	const setStatus = useMutation(api.admin.setCardStatus);
	async function moderate(cardId: Id<'knowledgeCards'>, to: 'published' | 'suppressed') {
		try {
			await setStatus({ token: adminAuth.token, cardId, status: to });
		} catch (err) {
			console.error('[admin/content] setCardStatus failed', err);
		}
	}
</script>

<svelte:head><title>Admin · Content</title></svelte:head>

<main class="admin">
	<h1>Content</h1>

	{#if unauthorized}
		<p class="msg err">
			Token rejected.
			<button type="button" class="link" onclick={() => adminAuth.clear()}>Re-enter token</button>
		</p>
	{:else}
		<div class="controls">
			<div class="tabs">
				{#each STATUSES as s (s)}
					<button
						type="button"
						class="tab"
						class:active={status === s}
						onclick={() => (status = s)}
					>
						{s.replace(/_/g, ' ')}
					</button>
				{/each}
			</div>
			<input class="search" bind:value={search} placeholder="Search hooks…" />
		</div>

		{#if cards.error}
			<p class="msg err">{cards.error.message}</p>
		{:else if cards.isLoading}
			<p class="hint">Loading…</p>
		{:else if rows.length === 0}
			<p class="hint">No {status.replace(/_/g, ' ')} cards.</p>
		{:else}
			<ul class="list">
				{#each rows as c (c._id)}
					<li>
						<div class="meta">
							<span class="fmt">{c.format.replace(/_/g, ' ')}</span>
							{#if c.supportScore !== null}
								<span class="score" class:low={c.supportScore < 0.8}>
									support {c.supportScore.toFixed(2)}
								</span>
							{/if}
						</div>
						<h2>{c.hook}</h2>
						<p class="body">{c.body}</p>
						<div class="actions">
							{#if c.status !== 'published' && c.status !== 'validation_failed'}
								<button type="button" class="publish" onclick={() => moderate(c._id, 'published')}>
									Publish
								</button>
							{/if}
							{#if c.status !== 'suppressed'}
								<button
									type="button"
									class="suppress"
									onclick={() => moderate(c._id, 'suppressed')}
								>
									Suppress
								</button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
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
	.controls {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.tab {
		font: inherit;
		font-size: 0.8rem;
		text-transform: capitalize;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}
	.tab.active {
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}
	.search {
		font: inherit;
		padding: 0.55rem 0.7rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.list li {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.1rem;
	}
	.meta {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.4rem;
	}
	.fmt {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
	}
	.score {
		font-size: 0.75rem;
		color: var(--positive);
	}
	.score.low {
		color: var(--negative);
	}
	h2 {
		font-size: 1.1rem;
		margin: 0 0 0.4rem;
	}
	.body {
		margin: 0 0 0.6rem;
		color: var(--text-2);
		line-height: 1.5;
		font-size: 0.92rem;
	}
	.actions {
		display: flex;
		gap: 0.6rem;
	}
	.actions button {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.4rem 0.9rem;
		border-radius: 8px;
		cursor: pointer;
		border: 1px solid var(--border);
		background: transparent;
	}
	.publish {
		color: var(--positive);
		border-color: var(--positive) !important;
	}
	.suppress {
		color: var(--negative);
		border-color: var(--negative) !important;
	}
</style>
