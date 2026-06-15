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
	let focusConcept = $state<string | null>(null);
	let activeCardId = $state<Id<'knowledgeCards'> | null>(null);
	let feedEl = $state<HTMLElement | null>(null);
	let sentinel = $state<HTMLDivElement | null>(null);
	let adaptTimer: ReturnType<typeof setTimeout> | null = null;

	// Getter args (convex-svelte footgun rule) + 'skip' until the device id resolves.
	const savedQuery = useQuery(api.saved.savedIds, () => (deviceId ? { deviceId } : 'skip'));
	const savedSet = $derived(new Set<string>((savedQuery.data ?? []).map(String)));
	const toggleSave = useMutation(api.saved.toggle);

	// Personalized feed: takes over from the SSR global feed once the device id
	// resolves and the profile loads (ADR-007). Reactive on the profile, so it
	// re-ranks live when recompute() runs after a strong signal.
	const personal = useQuery(api.feed.personal, () =>
		deviceId ? { deviceId, focusConcept: focusConcept ?? undefined } : 'skip'
	);
	const recompute = useMutation(api.profile.recompute);

	// Personalized once it loads; the SSR global feed until then. `notInterested`
	// is an in-memory optimistic hide for the gap before recompute() rewrites the
	// profile (the server is the durable source — feed.personal excludes them).
	const visibleResults = $derived(
		(personal.data ?? feed.results).filter((c) => !notInterested.has(c._id))
	);

	// Debounced: coalesce bursts of signals into one flush + profile rebuild.
	function scheduleAdapt() {
		if (!deviceId) return;
		if (adaptTimer) clearTimeout(adaptTimer);
		adaptTimer = setTimeout(async () => {
			adaptTimer = null;
			await flush(); // persist queued events before recompute reads them
			recompute({ deviceId }).catch((err) => console.error('[feed] recompute failed', err));
		}, 1500);
	}

	onMount(() => {
		deviceId = getDeviceId();
		const cleanupTelemetry = initTelemetry();
		track('session_start');
		scheduleAdapt(); // fold in prior sessions' signals
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
			scheduleAdapt();
		} catch (err) {
			console.error('[feed] save failed', err);
		}
	}

	function handleNotInterested(card: Doc<'knowledgeCards'>) {
		notInterested.add(card._id); // optimistic hide; recompute makes it durable
		track('not_interested', { cardId: card._id });
		scheduleAdapt();
	}

	// Tapping a concept chip focuses the feed on that concept: matching cards float
	// to the top (a re-rank, not a filter — the feed never empties) and we jump
	// back to the first card. Still a strong personalization signal.
	function handleRelated(card: Doc<'knowledgeCards'>, tag: string) {
		track('related_tap', { cardId: card._id });
		focusConcept = tag;
		feedEl?.scrollTo({ top: 0, behavior: 'smooth' });
		scheduleAdapt();
	}

	function clearFocus() {
		focusConcept = null;
		feedEl?.scrollTo({ top: 0, behavior: 'smooth' });
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
			case 'Escape':
				if (focusConcept) {
					e.preventDefault();
					clearFocus();
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

{#if focusConcept}
	<button type="button" class="focus-pill" onclick={clearFocus} data-testid="focus-pill">
		<span class="focus-label">Exploring</span>
		<span class="focus-concept">{focusConcept}</span>
		<span class="focus-x" aria-hidden="true">✕</span>
		<span class="sr-only">Clear focus</span>
	</button>
{/if}

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
			<p>More cards are on the way.</p>
		</section>
	{:else}
		{#each visibleResults as card (card._id)}
			<div
				class="slot"
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
					onRelated={(tag) => handleRelated(card, tag)}
				/>
			</div>
		{/each}
		<div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>
		{#if feed.status === 'LoadingMore'}
			<section class="state subtle">Loading more…</section>
		{/if}
	{/if}
</main>
