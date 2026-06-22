<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';
	import { useQuery, useMutation, usePaginatedQuery, getConvexClient } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import type { Doc, Id } from '$convex/_generated/dataModel';
	import type { PageData } from './$types';
	import Card from '$lib/components/Card.svelte';
	import SponsoredCard from '$lib/components/SponsoredCard.svelte';
	import AdNetworkSlot from '$lib/components/AdNetworkSlot.svelte';
	import CardActions from '$lib/components/CardActions.svelte';
	import { dwell } from '$lib/actions/dwell';
	import { swipeActions } from '$lib/actions/swipeActions';
	import { formatName } from '$lib/cards';
	import { getDeviceId } from '$lib/identity';
	import { initTelemetry, track, flush } from '$lib/telemetry';
	import { weaveFeed } from '$lib/feed';
	import { injectSponsored, type SlotMode } from '$lib/sponsored';
	import { getAdNetworkConfig } from '$lib/adNetwork';
	import { persistCards, readCards } from '$lib/offlineFeed';
	import { createToast } from '$lib/toast.svelte';
	import { cooldownGate } from '$lib/cooldownGate';
	import { shareCard } from '$lib/share';
	import { toSlug } from '$lib/slug';

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

	const interestsQuery = useQuery(api.interests.list, () => (deviceId ? { deviceId } : 'skip'));
	const followedSlugs = $derived(new Set<string>((interestsQuery.data ?? []).map((i) => i.slug)));
	const addInterest = useMutation(api.interests.add);
	const removeInterest = useMutation(api.interests.remove);
	function toggleFollow(card: Doc<'knowledgeCards'>) {
		if (!deviceId) return;
		const slug = toSlug(card.source.articleTitle);
		if (followedSlugs.has(slug)) void removeInterest({ deviceId, slug });
		else void addInterest({ deviceId, slug, title: card.source.articleTitle });
	}

	// Live paginated unseen feed: re-keys on deviceId + focusConcept so it
	// switches to personalized seen-exclusion once the device id resolves
	// (ADR-007). SSR first-paint comes from data.feed (anonymous, deviceId:'').
	const liveFeed = usePaginatedQuery(
		api.feed.unseen,
		() =>
			deviceId
				? { deviceId, focusConcept: focusConcept ?? undefined }
				: { deviceId: '', focusConcept: focusConcept ?? undefined },
		{ initialNumItems: 8 }
	);
	const recompute = useMutation(api.profile.recompute);

	// Engagement stats (streak): reactive HUD read + a once-per-session record.
	const stats = useQuery(api.stats.get, () => (deviceId ? { deviceId } : 'skip'));
	const recordActivity = useMutation(api.stats.recordActivity);
	const streak = $derived(stats.data?.currentStreak ?? 0);

	// Offline reading (PWA): mirror the live feed into IndexedDB, and fall back to
	// that cache when offline with nothing live to show. Read-only — saving and
	// personalization need the connection.
	let online = $state(true);
	let cachedOffline = $state<Doc<'knowledgeCards'>[]>([]);
	// liveFeed takes over from the SSR anonymous first-paint (data.feed) once
	// Switch to the live (deviceId-keyed) feed once its subscription has data or
	// finished its first load; until then show the SSR first-paint results.
	const hasLiveData = $derived(liveFeed.results.length > 0 || !liveFeed.isLoading);
	const liveCards = $derived(hasLiveData ? liveFeed.results : feed.results);
	const sourceCards = $derived(!online && liveCards.length === 0 ? cachedOffline : liveCards);
	const offlineFallback = $derived(!online && liveCards.length === 0 && cachedOffline.length > 0);

	$effect(() => {
		// Snapshot out of the Svelte/Convex reactive proxies first — IndexedDB's
		// structured clone can't serialize proxies (throws DataCloneError otherwise).
		if (online && liveCards.length > 0) void persistCards($state.snapshot(liveCards));
	});

	// `notInterested` is an in-memory optimistic hide for the gap before
	// recompute() rewrites the profile (the server is the durable source —
	// feed.unseen hard-excludes notInterested server-side).
	const visibleResults = $derived(
		weaveFeed(sourceCards, injectedAfter).filter((c) => !notInterested.has(c._id))
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
		online = navigator.onLine;
		const goOnline = () => (online = true);
		const goOffline = () => (online = false);
		window.addEventListener('online', goOnline);
		window.addEventListener('offline', goOffline);
		// Prime the offline cache so it's ready if the connection drops mid-session.
		readCards()
			.then((c) => (cachedOffline = c))
			.catch(() => {});
		const cleanupTelemetry = initTelemetry();
		track('session_start');
		scheduleAdapt(); // fold in prior sessions' signals
		// Register today's visit; celebrate a kept or new streak.
		recordActivity({ deviceId })
			.then((res) => {
				if (res.event === 'extended') toast.show(`${res.currentStreak}-day streak`);
				else if (res.event === 'started') toast.show('Streak started — see you tomorrow');
			})
			.catch((err) => console.error('[stats] recordActivity failed', err));
		return () => {
			track('session_end');
			void flush();
			toast.dismiss();
			cleanupTelemetry();
			window.removeEventListener('online', goOnline);
			window.removeEventListener('offline', goOffline);
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
			toast.show(`${milestone} ideas this session`);
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

	async function handleShare(card: Doc<'knowledgeCards'>) {
		const result = await shareCard(card._id, card.hook);
		if (result === 'copied') toast.show('Link copied');
		else if (result === 'failed') toast.show('Could not share');
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
			case 'Escape':
				if (focusConcept) {
					e.preventDefault();
					clearFocus();
				}
				break;
		}
	}

	// Prefetch the next batch as the sentinel nears the viewport (instant swipes).
	// Also fire a fire-and-forget supply trigger when the feed is running low so
	// the shared library stays ahead of heavy readers.
	$effect(() => {
		const el = sentinel;
		if (!el) return;
		const io = new IntersectionObserver(
			(entries) => {
				if (!entries[0]?.isIntersecting) return;
				if (liveFeed.status === 'CanLoadMore') liveFeed.loadMore(6);
				// Running-low trigger: ask the backend to generate more cards when the
				// feed is exhausted or nearing its end. Fire-and-forget — ignore result.
				if (
					deviceId !== '' &&
					online &&
					(liveFeed.status === 'Exhausted' || liveFeed.status === 'CanLoadMore')
				) {
					void getConvexClient().action(api.generationPipeline.ensureSupply, { deviceId });
				}
			},
			{ rootMargin: '800px' }
		);
		io.observe(el);
		return () => io.disconnect();
	});

	// Self-heal when the feed empties out completely. The sentinel-based running-low
	// trigger above can't fire at zero cards (the sentinel isn't rendered in the
	// empty state), so a heavy reader who exhausts the library would otherwise get
	// stuck. Request a supply pass once per exhaustion; the backend throttles it
	// (60s global cooldown), so this is cheap. Re-arms once cards return.
	let emptySupplyRequested = false;
	$effect(() => {
		const exhausted = deviceId !== '' && online && !liveFeed.isLoading && liveCards.length === 0;
		if (exhausted && !emptySupplyRequested) {
			emptySupplyRequested = true;
			void getConvexClient().action(api.generationPipeline.ensureSupply, { deviceId });
		} else if (liveCards.length > 0) {
			emptySupplyRequested = false;
		}
	});
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:head><title>Brain Rot Pro</title></svelte:head>

<!-- Scrim behind the fixed top controls: card images/titles read as sliding
     *under* the chrome instead of colliding with the pills' negative space. -->
<div class="feed-topscrim" aria-hidden="true"></div>

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
			<span class="hud-tick" aria-hidden="true"></span>
			<span class="hud-value">{streak}</span>
			<span class="hud-label" aria-hidden="true">{streak === 1 ? 'day' : 'days'}</span>
			<span class="sr-only">day streak</span>
		</span>
	{/if}
	{#if sessionCount > 0}
		<span class="hud-pill session" data-testid="session-count">
			<span class="hud-tick" aria-hidden="true"></span>
			{#key sessionCount}<span class="hud-value pop">{sessionCount}</span>{/key}
			<span class="hud-label" aria-hidden="true">read</span>
			<span class="sr-only">learned this session</span>
		</span>
	{/if}
</div>

{#if !online}
	<div class="offline-banner" role="status">
		Offline{offlineFallback ? ' — showing saved-for-offline cards' : ''}
	</div>
{/if}

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

<!-- Announce the active card to screen readers as it changes (ui-ux.md §8;
     polite so it never interrupts). -->
<div class="vh" aria-live="polite" aria-atomic="true">
	{#if activeCard}{formatName(activeCard.format)}. {activeCard.hook}{/if}
</div>

<main class="feed" data-testid="feed" bind:this={feedEl} aria-label="Knowledge feed">
	{#if liveFeed.error}
		<section class="state error">
			<h2>Something went wrong</h2>
			<p>{liveFeed.error.message}</p>
		</section>
	{:else if liveFeed.isLoading && liveCards.length === 0}
		<section class="state">Loading…</section>
	{:else if liveCards.length === 0}
		<section class="state">
			<h2>You're all caught up</h2>
			<p>Fresh cards are on the way — check back in a moment.</p>
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
					use:swipeActions={{
						onSave: () => {
							if (online) void handleSave(card);
						},
						onDismiss: () => {
							if (online) handleNotInterested(card);
						}
					}}
				>
					<Card
						{card}
						onSource={() => track('source_open', { cardId: card._id })}
						onRelated={online ? (tag) => handleRelated(card, tag) : undefined}
						onMore={online ? () => handleMore(card) : undefined}
						moreLoading={divingId === card._id}
						onExpand={() => handleExpand(card)}
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
		{#if liveFeed.status === 'LoadingMore'}
			<section class="state subtle">Loading more…</section>
		{:else if liveFeed.status === 'Exhausted'}
			<section class="state end">
				<span class="end-kicker">That's today</span>
				{#if sessionCount > 0}
					<h2>You explored {sessionCount} {sessionCount === 1 ? 'idea' : 'ideas'}</h2>
				{:else}
					<h2>You're caught up</h2>
				{/if}
				<p>More are on the way — pick the thread back up whenever you like.</p>
				<button
					type="button"
					class="restart"
					onclick={() => feedEl?.scrollTo({ top: 0, behavior: 'smooth' })}
				>
					Back to the top →
				</button>
			</section>
		{/if}
	{/if}
</main>

<!-- One viewport-fixed action bar for the active card: identical thumb-zone
     placement on every screen size, regardless of card content height. -->
{#if activeCard && visibleResults.length > 0 && online}
	<CardActions
		saved={savedSet.has(activeCard._id)}
		onSave={() => handleSave(activeCard)}
		following={followedSlugs.has(toSlug(activeCard.source.articleTitle))}
		onFollow={() => toggleFollow(activeCard)}
		onNotInterested={() => handleNotInterested(activeCard)}
		onShare={() => handleShare(activeCard)}
	/>
{/if}

<!-- Continuation cue: a quiet "there's more this way" that appears with the first
     card (you load at the top) and gently fades itself out after a few seconds so it
     never lingers — an orientation nudge, not permanent chrome (ui-ux.md §3). -->
{#if visibleResults.length > 0}
	<svg class="next-hint" viewBox="0 0 24 24" fill="none" aria-hidden="true">
		<path
			d="M5 9l7 7 7-7"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
{/if}
