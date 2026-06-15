<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
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

	// Personalized feed: takes over from the SSR global feed once the device id
	// resolves and the profile loads (ADR-007). Reactive on the profile, so it
	// re-ranks live when recompute() runs after a strong signal.
	const personal = useQuery(api.feed.personal, () => (deviceId ? { deviceId } : 'skip'));
	const recompute = useMutation(api.profile.recompute);

	const baseCards = $derived(personal.data ?? feed.results);
	const visibleResults = $derived(baseCards.filter((c) => !notInterested.has(c._id)));

	function adaptProfile() {
		if (!deviceId) return;
		recompute({ deviceId }).catch((err) => console.error('[feed] recompute failed', err));
	}

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
		adaptProfile(); // fold in prior sessions' signals
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
			await flush(); // make the signal visible to recompute
			adaptProfile();
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
		void flush().then(adaptProfile);
	}

	function handleRelated(card: Doc<'knowledgeCards'>) {
		// Boost this concept: log it, then re-rank toward related cards.
		track('related_tap', { cardId: card._id });
		void flush().then(adaptProfile);
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

<a class="feed-nav" href={resolve('/saved')}>Saved</a>

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
