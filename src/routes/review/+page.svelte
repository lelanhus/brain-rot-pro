<script lang="ts">
	import { resolve } from '$app/paths';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';

	// Admin review queue (design doc §17). No SSR needed — this is an internal tool.
	const queue = useQuery(api.review.queue, () => ({}));
	const items = $derived(queue.data ?? []);
	const approve = useMutation(api.review.approve);
	const reject = useMutation(api.review.reject);

	async function onApprove(id: Id<'knowledgeCards'>) {
		try {
			await approve({ cardId: id });
		} catch (e) {
			console.error('[review] approve failed', e);
		}
	}
	async function onReject(id: Id<'knowledgeCards'>) {
		try {
			await reject({ cardId: id });
		} catch (e) {
			console.error('[review] reject failed', e);
		}
	}
</script>

<svelte:head><title>Review queue</title></svelte:head>

<main class="admin">
	<header>
		<a href={resolve('/')}>← Feed</a>
		<h1>Review queue</h1>
	</header>

	{#if queue.error}
		<p class="msg error">{queue.error.message}</p>
	{:else if queue.isLoading}
		<p class="msg">Loading…</p>
	{:else if items.length === 0}
		<p class="msg">Nothing to review. Generate drafts with <code>generate:generateBatch</code>.</p>
	{:else}
		<ul>
			{#each items as card (card._id)}
				<li>
					<div class="meta">
						<span class="fmt">{card.format}</span>
						{#if card.supportScore !== null}
							<span class="score" class:low={card.supportScore < 0.8}>
								support {card.supportScore.toFixed(2)}
							</span>
						{/if}
					</div>
					<h2>{card.hook}</h2>
					<p>{card.body}</p>
					<details>
						<summary>Source span</summary>
						<blockquote>{card.sourceSpan}</blockquote>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external source link -->
						<a href={card.sourceUrl} target="_blank" rel="noreferrer noopener">{card.sourceUrl}</a>
					</details>
					<div class="actions">
						<button type="button" class="approve" onclick={() => onApprove(card._id)}
							>Approve</button
						>
						<button type="button" class="reject" onclick={() => onReject(card._id)}>Reject</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.admin {
		max-width: 760px;
		margin: 0 auto;
		padding: 1.5rem 1.25rem 4rem;
	}
	header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 1.5rem;
	}
	header a {
		color: var(--muted);
		font-size: 0.9rem;
	}
	h1 {
		margin: 0;
		font-size: 1.4rem;
	}
	.msg {
		color: var(--muted);
	}
	ul {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	li {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.1rem;
	}
	.meta {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.5rem;
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
		font-size: 1.15rem;
		margin: 0 0 0.4rem;
	}
	p {
		margin: 0 0 0.6rem;
		color: var(--text-2);
		line-height: 1.5;
	}
	blockquote {
		border-left: 2px solid var(--border);
		margin: 0.5rem 0;
		padding-left: 0.75rem;
		font-style: italic;
		color: var(--muted);
	}
	.actions {
		display: flex;
		gap: 0.6rem;
		margin-top: 0.75rem;
	}
	button {
		font: inherit;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		cursor: pointer;
		border: 1px solid var(--border);
	}
	.approve {
		background: var(--positive);
		color: #06281c;
		border-color: var(--positive);
	}
	.reject {
		background: transparent;
		color: var(--negative);
		border-color: var(--negative);
	}
</style>
