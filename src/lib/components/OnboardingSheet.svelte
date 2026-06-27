<script lang="ts">
	import { resolve } from '$app/paths';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import { slugToDisplay } from '$lib/slug';
	import { toggleInterest } from '$lib/interests';
	import { isRateLimited } from '$lib/errors';
	import { createToast } from '$lib/toast.svelte';

	let { deviceId, onDone }: { deviceId: string; onDone: () => void } = $props();

	const toast = createToast();
	const suggestions = useQuery(api.topics.topByPageviews, () => ({ limit: 18 }));
	const interestsQuery = useQuery(api.interests.list, () => (deviceId ? { deviceId } : 'skip'));
	const followedSlugs = $derived(new Set<string>((interestsQuery.data ?? []).map((i) => i.slug)));
	const addInterest = useMutation(api.interests.add);
	const removeInterest = useMutation(api.interests.remove);

	function addWithToast(args: { deviceId: string; slug: string; title: string }): Promise<void> {
		return addInterest(args)
			.then(() => undefined)
			.catch((err: unknown) => {
				if (isRateLimited(err)) toast.show('Slow down a moment');
				else throw err;
			});
	}

	const toggle = (slug: string, title: string) =>
		toggleInterest(followedSlugs, slug, title, {
			deviceId,
			add: addWithToast,
			remove: removeInterest
		});
</script>

{#if toast.message}
	{#key toast.id}
		<div class="toast" role="status">{toast.message}</div>
	{/key}
{/if}

<div class="overlay" role="dialog" aria-modal="true" aria-label="Pick your interests">
	<div class="sheet">
		<h1>What are you into?</h1>
		<p class="sub">Pick a few topics to shape your feed — you can change these anytime.</p>
		<div class="chips">
			{#each suggestions.data ?? [] as t (t.slug)}
				<button
					type="button"
					class="chip"
					class:active={followedSlugs.has(t.slug)}
					aria-pressed={followedSlugs.has(t.slug)}
					onclick={() => toggle(t.slug, t.title)}
				>
					{slugToDisplay(t.title)}
				</button>
			{/each}
		</div>
		<button type="button" class="start" onclick={onDone}>Start reading</button>
		<p class="signin">
			<a href={resolve('/account')}>Sign in to save your interests across devices →</a>
		</p>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: var(--bg);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem;
		overflow-y: auto;
	}
	.sheet {
		max-width: 560px;
		width: 100%;
	}
	h1 {
		font-size: 1.5rem;
		margin: 0 0 0.4rem;
	}
	.sub {
		color: var(--muted);
		line-height: 1.5;
		margin: 0 0 1.25rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}
	.chip {
		font: inherit;
		cursor: pointer;
		padding: 0.5rem 0.9rem;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
	}
	.chip.active {
		color: var(--accent);
		border-color: var(--accent);
	}
	.start {
		font: inherit;
		font-weight: 700;
		cursor: pointer;
		width: 100%;
		padding: 0.8rem;
		border-radius: var(--radius);
		border: none;
		background: var(--accent);
		color: var(--bg);
	}
	.signin {
		text-align: center;
		margin: 1rem 0 0;
		font-size: 0.9rem;
	}
	.signin a {
		color: var(--muted);
	}
</style>
