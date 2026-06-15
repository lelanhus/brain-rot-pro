<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import type { Doc, Id } from '$convex/_generated/dataModel';
	import type { PageData } from './$types';
	import Card from '$lib/components/Card.svelte';
	import { dwell } from '$lib/actions/dwell';
	import { getDeviceId } from '$lib/identity';
	import { initTelemetry, track, flush } from '$lib/telemetry';

	let { data }: { data: PageData } = $props();
	const feed = $derived(data.feed);

	let deviceId = $state('');
	const notInterested = new SvelteSet<string>();
	let activeCardId = $state<Id<'knowledgeCards'> | null>(null);
	let feedEl = $state<HTMLElement | null>(null);
	let sentinel = $state<HTMLDivElement | null>(null);

	const NI_KEY = 'brp:notInterested';

	// Getter args (convex-svelte footgun rule) + 'skip' until the device id resolves.
	const savedQuery = useQuery(api.saved.savedIds, () => (deviceId ? { deviceId } : 'skip'));
	const savedSet = $derived(new Set<string>((savedQuery.data ?? []).map(String)));
	const toggleSave = useMutation(api.saved.toggle);

	const visibleResults = $derived(feed.results.filter((c) => !notInterested.has(c._id)));

	onMount(() => {
		deviceId = getDeviceId();
		try {
			const stored = localStorage.getItem(NI_KEY);
			if (stored) for (const id of JSON.parse(stored) as string[]) notInterested.add(id);
		} catch {
			/* corrupt storage — start fresh */
		}
		const cleanupTelemetry = initTelemetry();
		track('session_start');
		return () => {
			track('session_end');
			void flush();
			cleanupTelemetry();
		};
	});

	async function handleSave(card: Doc<'knowledgeCards'>) {
		if (!deviceId) return;
		try {
			const res = await toggleSave({ deviceId, cardId: card._id });
			track(res.saved ? 'save' : 'unsave', { cardId: card._id });
		} catch (err) {
			console.error('[feed] save failed', err);
		}
	}

	function handleNotInterested(card: Doc<'knowledgeCards'>) {
		notInterested.add(card._id);
		try {
			localStorage.setItem(NI_KEY, JSON.stringify([...notInterested]));
		} catch {
			/* storage unavailable — keep the in-memory filter */
		}
		track('not_interested', { cardId: card._id });
	}

	function handleRelated(card: Doc<'knowledgeCards'>) {
		// Phase 3 will pivot the feed toward this concept; for now we just log it.
		track('related_tap', { cardId: card._id });
	}

	function scrollByViewport(dir: 1 | -1) {
		feedEl?.scrollBy({ top: dir * window.innerHeight, behavior: 'smooth' });
	}

	function onKeydown(e: KeyboardEvent) {
		const target = e.target;
		if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
		const active = activeCardId ? visibleResults.find((c) => c._id === activeCardId) : null;
		switch (e.key) {
			case 'ArrowDown':
			case ' ':
				e.preventDefault();
				scrollByViewport(1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				scrollByViewport(-1);
				break;
			case 's':
			case 'S':
				if (active) {
					e.preventDefault();
					void handleSave(active);
				}
				break;
			case 'x':
			case 'X':
				if (active) {
					e.preventDefault();
					handleNotInterested(active);
				}
				break;
			case 'v':
			case 'V':
				if (activeCardId) {
					const d = document.querySelector<HTMLDetailsElement>(
						`[data-card-id="${activeCardId}"] details.source`
					);
					if (d) {
						d.open = !d.open;
						if (d.open) track('source_open', { cardId: activeCardId });
					}
				}
				break;
		}
	}

	// Prefetch the next batch as the sentinel nears the viewport (instant swipes).
	$effect(() => {
		const el = sentinel;
		if (!el) return;
		const io = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting && feed.status === 'CanLoadMore') feed.loadMore(6);
			},
			{ rootMargin: '800px' }
		);
		io.observe(el);
		return () => io.disconnect();
	});
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:head><title>Brain Rot Pro</title></svelte:head>

<main class="feed" data-testid="feed" bind:this={feedEl} aria-label="Knowledge feed">
	{#if feed.error}
		<section class="state error">
			<h2>Something went wrong</h2>
			<p>{feed.error.message}</p>
		</section>
	{:else if feed.isLoading && feed.results.length === 0}
		<section class="state">Loading…</section>
	{:else if feed.results.length === 0}
		<section class="state">
			<h2>No cards yet</h2>
			<p>Seed the library: <code>npx convex run seed:seed</code></p>
		</section>
	{:else if visibleResults.length === 0}
		<section class="state">
			<h2>You've hidden everything here</h2>
			<p>Reload to reset hidden cards.</p>
		</section>
	{:else}
		{#each visibleResults as card (card._id)}
			<div
				class="slot"
				data-card-id={card._id}
				use:dwell={{
					cardId: card._id,
					body: card.body,
					onActive: (id) => (activeCardId = id)
				}}
			>
				<Card
					{card}
					saved={savedSet.has(card._id)}
					onSave={() => handleSave(card)}
					onNotInterested={() => handleNotInterested(card)}
					onSource={() => track('source_open', { cardId: card._id })}
					onRelated={() => handleRelated(card)}
				/>
			</div>
		{/each}
		<div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>
		{#if feed.status === 'LoadingMore'}
			<section class="state subtle">Loading more…</section>
		{/if}
	{/if}
</main>
