<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';
	import { useQuery, useMutation, getConvexClient } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import type { Doc, Id } from '$convex/_generated/dataModel';
	import type { PageData } from './$types';
	import Card from '$lib/components/Card.svelte';
	import SponsoredCard from '$lib/components/SponsoredCard.svelte';
	import AdNetworkSlot from '$lib/components/AdNetworkSlot.svelte';
	import { dwell } from '$lib/actions/dwell';
	import { getDeviceId } from '$lib/identity';
	import { initTelemetry, track, flush } from '$lib/telemetry';
	import { weaveFeed } from '$lib/feed';
	import { injectSponsored, type SlotMode } from '$lib/sponsored';
	import { getAdNetworkConfig } from '$lib/adNetwork';
	import { createToast } from '$lib/toast.svelte';

	let { data }: { data: PageData } = $props();
	const feed = $derived(data.feed);

	let deviceId = $state('');
	const notInterested = new SvelteSet<string>();
	// Seeded from a shared/deep-linked ?focus= (e.g. a concept chip tapped on
	// /saved); read once from SvelteKit's reactive page state, not window.location.
	let focusConcept = $state<string | null>(page.url.searchParams.get('focus'));
	let activeCardId = $state<Id<'knowledgeCards'> | null>(null);

	// Semantic "more like this": related cards woven into the feed right after the
	// card you dived from (the rabbit hole). `divingId` drives the button's spinner.
	const injectedAfter = new SvelteMap<string, Doc<'knowledgeCards'>[]>();
	let divingId = $state<string | null>(null);

	// Momentum (engagement layer): a live count of cards completed this session and
	// a transient celebration toast. Streak lives server-side; session count is
	// client-only so it ticks instantly. Each card counts once per session.
	const completedThisSession = new SvelteSet<string>();
	let sessionCount = $state(0);
	let lastMilestone = $state(0);
	const toast = createToast();

	const SESSION_MILESTONES = [5, 10, 25, 50, 100];

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

	// Engagement stats (streak): reactive HUD read + a once-per-session record.
	const stats = useQuery(api.stats.get, () => (deviceId ? { deviceId } : 'skip'));
	const recordActivity = useMutation(api.stats.recordActivity);
	const streak = $derived(stats.data?.currentStreak ?? 0);

	// Personalized once it loads; the SSR global feed until then. `notInterested`
	// is an in-memory optimistic hide for the gap before recompute() rewrites the
	// profile (the server is the durable source — feed.personal excludes them).
	const visibleResults = $derived(
		weaveFeed(personal.data ?? feed.results, injectedAfter).filter((c) => !notInterested.has(c._id))
	);

	// Monetization (ADR-008): sponsored "Go deeper" slots woven into the feed at a
	// capped cadence. Provider precedence — an env-configured ad network fills the
	// slot if present; otherwise contextual affiliate offers do; otherwise no slot.
	const adConfig = getAdNetworkConfig();
	const offers = useQuery(api.affiliate.active, () => ({}));
	const dismissedOffers = new SvelteSet<string>();
	const slotMode = $derived<SlotMode>(
		adConfig ? 'network' : (offers.data ?? []).length > 0 ? 'offers' : 'off'
	);
	// Cards woven in by "more like this" — never place a slot just before one, so
	// a rabbit-hole dive is never split.
	const relatedIds = $derived(new Set([...injectedAfter.values()].flat().map((c) => c._id)));
	const feedItems = $derived(
		injectSponsored(visibleResults, {
			mode: slotMode,
			offers: (offers.data ?? []).filter((o) => !dismissedOffers.has(o._id)),
			skipBefore: relatedIds
		})
	);

	function handleSponsoredImpression(offerId: string) {
		track('sponsored_impression', { offerId: offerId as Id<'affiliateOffers'> });
	}
	function handleSponsoredClick(offerId: string) {
		track('sponsored_click', { offerId: offerId as Id<'affiliateOffers'> });
	}
	function handleSponsoredDismiss(offerId: string) {
		dismissedOffers.add(offerId); // session-scoped suppression (no account yet)
	}

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
		// Register today's visit; celebrate a kept or new streak.
		recordActivity({ deviceId })
			.then((res) => {
				if (res.event === 'extended') toast.show(`🔥 ${res.currentStreak}-day streak!`);
				else if (res.event === 'started') toast.show('🔥 Streak started — see you tomorrow!');
			})
			.catch((err) => console.error('[stats] recordActivity failed', err));
		return () => {
			track('session_end');
			void flush();
			toast.dismiss();
			cleanupTelemetry();
		};
	});

	// One card finished (dwell ≥ threshold): tick the live counter and celebrate
	// milestones. Counted once per card per session.
	function handleComplete(cardId: string) {
		if (completedThisSession.has(cardId)) return;
		completedThisSession.add(cardId);
		sessionCount += 1;
		const milestone = SESSION_MILESTONES.find((m) => m === sessionCount);
		if (milestone && milestone > lastMilestone) {
			lastMilestone = milestone;
			toast.show(`✨ ${milestone} learned this session!`);
		}
	}

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

	// Dive into a card: fetch semantically-related cards and weave them in right
	// after it, then advance so the next card up is the first related one.
	async function handleMore(card: Doc<'knowledgeCards'>) {
		if (divingId || injectedAfter.has(card._id)) {
			scrollByViewport(1);
			return;
		}
		divingId = card._id;
		track('related_tap', { cardId: card._id });
		try {
			const related = (await getConvexClient().action(api.embeddings.forCard, {
				cardId: card._id,
				limit: 3
			})) as Doc<'knowledgeCards'>[];
			const fresh = related.filter((r) => !notInterested.has(r._id));
			if (fresh.length === 0) {
				toast.show('No related cards yet — keep exploring');
			} else {
				injectedAfter.set(card._id, fresh);
				scheduleAdapt();
				await tick();
				scrollByViewport(1);
			}
		} catch (err) {
			console.error('[feed] more-like-this failed', err);
			toast.show('Could not load related cards');
		} finally {
			divingId = null;
		}
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

<nav class="feed-nav">
	<a class="nav-pill" href={resolve('/saved')}>Saved</a>
	<a class="nav-pill" href={resolve('/account')}>Account</a>
</nav>

<div class="hud" aria-live="polite">
	{#if streak > 0}
		<span
			class="hud-pill streak"
			title={`Longest streak: ${stats.data?.longestStreak ?? streak} days · ${stats.data?.daysLearned ?? 0} days learned`}
		>
			<span class="hud-icon" aria-hidden="true">🔥</span>
			<span class="hud-value">{streak}</span>
			<span class="sr-only">day streak</span>
		</span>
	{/if}
	{#if sessionCount > 0}
		<span class="hud-pill session" data-testid="session-count">
			<span class="hud-icon" aria-hidden="true">✨</span>
			{#key sessionCount}<span class="hud-value pop">{sessionCount}</span>{/key}
			<span class="sr-only">learned this session</span>
		</span>
	{/if}
</div>

{#if toast.message}
	{#key toast.id}
		<div class="toast" role="status" data-testid="toast">{toast.message}</div>
	{/key}
{/if}

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
		{#each feedItems as item (item.kind === 'card' ? item.card._id : item.id)}
			{#if item.kind === 'card'}
				{@const card = item.card}
				<div
					class="slot"
					use:dwell={{
						cardId: card._id,
						body: card.body,
						onActive: (id) => (activeCardId = id),
						onComplete: (id) => handleComplete(id)
					}}
				>
					<Card
						{card}
						saved={savedSet.has(card._id)}
						onSave={() => handleSave(card)}
						onNotInterested={() => handleNotInterested(card)}
						onSource={() => track('source_open', { cardId: card._id })}
						onRelated={(tag) => handleRelated(card, tag)}
						onMore={() => handleMore(card)}
						moreLoading={divingId === card._id}
					/>
				</div>
			{:else if item.offer}
				<div class="slot">
					<SponsoredCard
						offer={item.offer}
						onImpression={() => item.offer && handleSponsoredImpression(item.offer._id)}
						onClick={() => item.offer && handleSponsoredClick(item.offer._id)}
						onDismiss={() => item.offer && handleSponsoredDismiss(item.offer._id)}
					/>
				</div>
			{:else if adConfig}
				<div class="slot">
					<AdNetworkSlot config={adConfig} />
				</div>
			{/if}
		{/each}
		<div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>
		{#if feed.status === 'LoadingMore'}
			<section class="state subtle">Loading more…</section>
		{/if}
	{/if}
</main>
