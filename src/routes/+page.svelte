<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import type { Doc, Id } from '$convex/_generated/dataModel';
	import type { PageData } from './$types';
	import Card from '$lib/components/Card.svelte';
	import CardActions from '$lib/components/CardActions.svelte';
	import { dwell } from '$lib/actions/dwell';
	import { swipeActions } from '$lib/actions/swipeActions';
	import { formatName } from '$lib/cards';
	import { getDeviceId } from '$lib/identity';
	import { initTelemetry, track, flush } from '$lib/telemetry';
	import { cooldownGate } from '$lib/cooldownGate';

	let { data }: { data: PageData } = $props();
	const feed = $derived(data.feed);

	let deviceId = $state('');
	const notInterested = new SvelteSet<string>();
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
	const personal = useQuery(api.feed.personal, () => (deviceId ? { deviceId } : 'skip'));
	const recompute = useMutation(api.profile.recompute);

	// Personalized once it loads; the SSR global feed until then. `notInterested`
	// is an in-memory optimistic hide for the gap before recompute() rewrites the
	// profile (the server is the durable source — feed.personal excludes them).
	const visibleResults = $derived(
		(personal.data ?? feed.results).filter((c) => !notInterested.has(c._id))
	);

	// The single fixed action bar targets whichever card is currently in view
	// (set by the dwell action). Fall back to the first card before the observer
	// fires so the controls are present from the first paint.
	const activeCard = $derived(
		visibleResults.find((c) => c._id === activeCardId) ?? visibleResults[0]
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

	// The dismiss button is stationary and the next card snaps into its slot
	// instantly, so a double-click (or rapid second click) would otherwise dismiss
	// two cards in one gesture. Swallow a repeat within the cooldown window.
	const allowDismiss = cooldownGate(350);

	function handleNotInterested(card: Doc<'knowledgeCards'>) {
		if (!allowDismiss()) return;
		notInterested.add(card._id); // optimistic hide; recompute makes it durable
		track('not_interested', { cardId: card._id });
		scheduleAdapt();
	}

	function handleRelated(card: Doc<'knowledgeCards'>) {
		track('related_tap', { cardId: card._id });
		scheduleAdapt();
	}

	function handleExpand(card: Doc<'knowledgeCards'>) {
		track('card_expand', { cardId: card._id }); // going deeper is a positive signal
		scheduleAdapt();
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

<!-- Announce the active card to screen readers as it changes (ui-ux.md §8;
     polite so it never interrupts). -->
<div class="vh" aria-live="polite" aria-atomic="true">
	{#if activeCard}{formatName(activeCard.format)}. {activeCard.hook}{/if}
</div>

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
				use:swipeActions={{
					onSave: () => handleSave(card),
					onDismiss: () => handleNotInterested(card)
				}}
			>
				<Card
					{card}
					onSource={() => track('source_open', { cardId: card._id })}
					onRelated={() => handleRelated(card)}
					onExpand={() => handleExpand(card)}
				/>
			</div>
		{/each}
		<div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>
		{#if feed.status === 'LoadingMore'}
			<section class="state subtle">Loading more…</section>
		{:else if feed.status === 'Exhausted'}
			<section class="state end">
				<h2>You're caught up</h2>
				<p>That's every idea for now — more are on the way.</p>
				<button
					type="button"
					class="restart"
					onclick={() => feedEl?.scrollTo({ top: 0, behavior: 'smooth' })}
				>
					Back to the top
				</button>
			</section>
		{/if}
	{/if}
</main>

<!-- One viewport-fixed action bar for the active card: identical thumb-zone
     placement on every screen size, regardless of card content height. -->
{#if activeCard && visibleResults.length > 0}
	<CardActions
		saved={savedSet.has(activeCard._id)}
		onSave={() => handleSave(activeCard)}
		onNotInterested={() => handleNotInterested(activeCard)}
	/>
{/if}
