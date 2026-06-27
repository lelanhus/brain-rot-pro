<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { beforeNavigate } from '$app/navigation';
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
	import { formatName } from '$lib/cards';
	import { deviceSession } from '$lib/deviceSession.svelte';
	import { initTelemetry, track, flush } from '$lib/telemetry';
	import { weaveFeed } from '$lib/feed';
	import { mergeStableOrder } from '$lib/feedOrder';
	import { buildResume, canResume, type FeedResume } from '$lib/feedResume';
	import { injectSponsored, type SlotMode } from '$lib/sponsored';
	import { getAdNetworkConfig } from '$lib/adNetwork';
	import { persistCards, readCards } from '$lib/offlineFeed';
	import { isRateLimited } from '$lib/errors';
	import { cooldownGate } from '$lib/cooldownGate';
	import { shareCard } from '$lib/share';
	import { toSlug } from '$lib/slug';
	import OnboardingSheet from '$lib/components/OnboardingSheet.svelte';
	import { isOnboarded, markOnboarded } from '$lib/onboarding';

	let { data }: { data: PageData } = $props();
	const feed = $derived(data.feed);

	// B1: the session-derived device principal (anonymous-first). '' until the
	// session resolves; the SSR/global-feed path and `'skip'` guards cover the gap.
	const deviceId = $derived(deviceSession.deviceId);
	let showOnboarding = $state(false);
	const notInterested = new SvelteSet<string>();
	// Taste signal (redesign §5): like (double-tap / rail) and dislike (rail) are
	// mutually exclusive + reversible. Session-local optimistic state; the durable
	// signal is the like/dislike event the server folds into personalization.
	const likedIds = new SvelteSet<string>();
	const dislikedIds = new SvelteSet<string>();
	// Seeded from a shared/deep-linked ?focus= (e.g. a concept chip tapped on
	// /saved); read once from SvelteKit's reactive page state, not window.location.
	let focusConcept = $state<string | null>(page.url.searchParams.get('focus'));
	let activeCardId = $state<Id<'knowledgeCards'> | null>(null);

	// Semantic "more like this": related cards woven into the feed right after the
	// card you dived from (the rabbit hole). `divingId` drives the button's spinner.
	const injectedAfter = new SvelteMap<string, Doc<'knowledgeCards'>[]>();
	let divingId = $state<string | null>(null);

	// Once-per-session set: dedupes the connected-wander threading signal so a card
	// re-entering the viewport doesn't re-thread the feed. (No session/streak counter
	// — the gamification HUD was removed; threading is the only consumer now.)
	const completedThisSession = new SvelteSet<string>();

	// Connected-wander threading: bias the live feed toward neighbors of the last
	// completed card. Updated at a coarse cadence (inside scheduleAdapt's settle
	// callback, ~1.5s after the last engagement signal) to avoid jarring re-sorts.
	let threadCardId = $state<Id<'knowledgeCards'> | null>(null);
	// Non-reactive staging var: captures the latest completed card immediately but
	// only promotes it to threadCardId (triggering a feed re-query) inside the
	// debounced settle, so the feed re-sorts at most once per ~1.5s window.
	let _pendingThreadCardId: Id<'knowledgeCards'> | null = null;
	let shareCopied = $state(false);
	let shareCopiedTimer: ReturnType<typeof setTimeout> | null = null;

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
		else
			addInterest({ deviceId, slug, title: card.source.articleTitle }).catch((err) => {
				// Rate-limited follows are silently dropped (unreachable for a human at
				// 20/min); only genuine failures are logged.
				if (!isRateLimited(err)) console.error('[interests] add failed', err);
			});
	}

	// Live paginated unseen feed: re-keys on deviceId + focusConcept so it
	// switches to personalized seen-exclusion once the device id resolves
	// (ADR-007). SSR first-paint comes from data.feed (anonymous, deviceId:'').
	// threadCardId biases ranking toward neighbors of the last completed card
	// (connected-wander); it is updated at a coarse ~1.5s cadence via scheduleAdapt
	// so re-sorts are infrequent and don't feel jarring.
	const liveFeed = usePaginatedQuery(
		api.feed.unseen,
		() =>
			deviceId
				? {
						deviceId,
						focusConcept: focusConcept ?? undefined,
						threadFromCardId: threadCardId ?? undefined
					}
				: { deviceId: '', focusConcept: focusConcept ?? undefined },
		{ initialNumItems: 8 }
	);
	const recompute = useMutation(api.profile.recompute);

	// Daily-activity record (drives the streak shown on the account page). Recorded
	// silently here — the feed no longer surfaces a streak/session HUD. Fired
	// reactively once the session-derived deviceId resolves (it's '' at mount until
	// the anonymous session + Convex token are ready), once per identity — never at
	// mount with an empty id, which the server would reject `unauthenticated`.
	const recordActivity = useMutation(api.stats.recordActivity);
	let lastActivityDevice = '';
	$effect(() => {
		if (!deviceId || deviceId === lastActivityDevice) return;
		lastActivityDevice = deviceId;
		// Fire once the deviceId resolves, but give the Convex auth token (~400ms)
		// a moment to attach first — firing immediately races it and the client
		// logs an `unauthenticated` error even though our retry would recover.
		// Retry a few times after that to cover a slower attach. Silent streak
		// update — non-critical if it ultimately fails.
		const id = deviceId;
		const attempt = (left: number): void => {
			recordActivity({ deviceId: id }).catch((err) => {
				if (left > 0) setTimeout(() => attempt(left - 1), 1500);
				else console.error('[stats] recordActivity failed', err);
			});
		};
		setTimeout(() => attempt(3), 1200);
	});

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

	// ── Stable display order (stops the feed from scrolling itself) ────────────
	// The live paginated query carries no keepPreviousData, so ANY ranking change
	// — taste recompute, focus concept, or connected-wander threading — RESETS it
	// to a fresh first page of `initialNumItems`. Left raw, re-ranking the cards
	// already under the reader yanks a new card into the viewport; it dwell-
	// completes, which threads again and re-ranks again: a loop that scrolls the
	// feed on its own (and drains the unseen pool, repeatedly tripping generation).
	// We keep a frozen, append-only display order so a PASSIVE re-rank only changes
	// which cards appear next — never where the reader already is. Explicit
	// re-ranks (a new device identity, or a focus-concept jump where floating
	// matches to the top IS the intent) adopt the incoming order wholesale.
	const cardStore = new SvelteMap<string, Doc<'knowledgeCards'>>();
	let displayIds = $state<string[]>([]);
	let prevKey: string | undefined = undefined; // non-reactive: last explicit-rerank key
	let rebuild = true; // adopt incoming wholesale on the next settled page
	function sameOrder(a: readonly string[], b: readonly string[]): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
		return true;
	}
	$effect(() => {
		const incoming = sourceCards;
		const loadingFirst = liveFeed.status === 'LoadingFirstPage';
		// Only deviceId + focusConcept are *explicit* re-ranks; threadFromCardId is
		// deliberately excluded so threading never rebuilds the visible order.
		const key = `${deviceId}|${focusConcept ?? ''}`;
		if (key !== prevKey) {
			prevKey = key;
			rebuild = true;
			cardStore.clear();
		}
		for (const c of incoming) cardStore.set(c._id, c);
		const incomingIds = incoming.map((c) => c._id);
		// A rebuild waits for the refetched page to actually land — the reset blanks
		// the live results for a tick first — so we don't lock in stale order.
		if (rebuild && (loadingFirst || incomingIds.length === 0)) {
			if (!sameOrder(displayIds, incomingIds)) displayIds = incomingIds;
			return;
		}
		const next = mergeStableOrder(rebuild ? [] : displayIds, incomingIds, rebuild);
		rebuild = false;
		if (!sameOrder(displayIds, next)) displayIds = next;
	});
	const orderedCards = $derived(
		displayIds
			.map((id) => cardStore.get(id))
			.filter((c): c is Doc<'knowledgeCards'> => c !== undefined)
	);

	// ── Return-to-feed resume ($lib/feedResume) ────────────────────────────────
	// Navigating to /search or /account unmounts the feed; the card the reader was
	// on is already in seenCards (dwell fires complete/skip on the way out), so the
	// live feed can never refetch it and scroll resets to top. Snapshot the
	// on-screen cards + active card on leave (sessionStorage) and re-seed on
	// return so the reader lands exactly where they left; new unseen cards still
	// append below (mergeStableOrder never drops the restored ids).
	const RESUME_KEY = 'brp:feedResume';
	let pendingResumeId: string | null = null; // scroll target, applied once the seed renders

	function readResume(): FeedResume | null {
		if (typeof sessionStorage === 'undefined') return null;
		try {
			const raw = sessionStorage.getItem(RESUME_KEY);
			return raw === null ? null : (JSON.parse(raw) as FeedResume);
		} catch {
			return null;
		}
	}

	function applyResume() {
		const snap = readResume();
		if (!canResume(snap, deviceId)) return;
		for (const c of snap.cards) cardStore.set(c._id, c);
		displayIds = snap.cards.map((c) => c._id);
		// Adopt the restored order WITHOUT a rebuild: the next live page (which now
		// excludes these seen cards) merges in below instead of replacing them.
		prevKey = `${deviceId}|${focusConcept ?? ''}`;
		rebuild = false;
		activeCardId = (snap.activeId as Id<'knowledgeCards'> | null) ?? activeCardId;
		pendingResumeId = snap.activeId ?? snap.cards[0]?._id ?? null;
	}

	// The card occupying the middle of the viewport, read straight from the DOM —
	// robust regardless of the dwell observer's active-card tracking.
	function topCardId(): string | null {
		if (!feedEl) return null;
		const mid = feedEl.clientHeight / 2;
		for (const s of feedEl.querySelectorAll<HTMLElement>('.slot[data-card-id]')) {
			const r = s.getBoundingClientRect();
			if (r.top <= mid && r.bottom >= mid) return s.getAttribute('data-card-id');
		}
		return null;
	}

	// Persist on the way out — beforeNavigate covers link clicks and back/forward.
	beforeNavigate(() => {
		if (typeof sessionStorage === 'undefined') return;
		const snap = buildResume(
			deviceId,
			topCardId(),
			$state.snapshot(orderedCards) as Doc<'knowledgeCards'>[]
		);
		try {
			if (snap !== null) sessionStorage.setItem(RESUME_KEY, JSON.stringify(snap));
		} catch {
			/* sessionStorage unavailable/full — resume is best-effort */
		}
	});

	// `notInterested` is an in-memory optimistic hide for the gap before
	// recompute() rewrites the profile (the server is the durable source —
	// feed.unseen hard-excludes notInterested server-side).
	const visibleResults = $derived(
		weaveFeed(orderedCards, injectedAfter).filter((c) => !notInterested.has(c._id))
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
			// Commit the latest completed card to the feed query arg here (coarse,
			// ~1.5s cadence) so the live feed re-sorts at most once per settle, not
			// on every dwell tick or scroll event.
			if (_pendingThreadCardId !== null) threadCardId = _pendingThreadCardId;
			await flush(); // persist queued events before recompute reads them
			recompute({ deviceId }).catch((err) => console.error('[feed] recompute failed', err));
		}, 1500);
	}

	onDestroy(() => {
		if (shareCopiedTimer) clearTimeout(shareCopiedTimer);
	});

	onMount(() => {
		// Re-seed the feed from the saved snapshot BEFORE the live query reconciles,
		// then scroll back to the card the reader left on.
		applyResume();
		if (pendingResumeId !== null) {
			const target = pendingResumeId;
			void tick().then(() => {
				const el = feedEl?.querySelector(`.slot[data-card-id="${target}"]`);
				if (el instanceof HTMLElement) el.scrollIntoView({ block: 'start' });
				pendingResumeId = null;
			});
		}
		if (!isOnboarded()) showOnboarding = true;
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
		return () => {
			track('session_end');
			void flush();
			cleanupTelemetry();
			window.removeEventListener('online', goOnline);
			window.removeEventListener('offline', goOffline);
		};
	});

	// One card finished (dwell ≥ threshold): stage it for connected-wander threading.
	// Once per card per session — the dedupe stops a re-viewed card from re-threading.
	function handleComplete(cardId: string) {
		if (completedThisSession.has(cardId)) return;
		completedThisSession.add(cardId);
		// Stage the completed card for threading; scheduleAdapt's settle will
		// promote it to threadCardId at the coarse ~1.5s cadence.
		_pendingThreadCardId = cardId as Id<'knowledgeCards'>;
		scheduleAdapt();
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
		if (result === 'copied') {
			shareCopied = true;
			if (shareCopiedTimer) clearTimeout(shareCopiedTimer);
			shareCopiedTimer = setTimeout(() => (shareCopied = false), 1500);
		} else if (result === 'failed') {
			console.error('[share] failed');
		}
		// 'shared' (OS sheet confirmed) and 'cancelled' show nothing.
	}

	// The dismiss button is stationary and the next card snaps into its slot
	// instantly, so a double-click (or rapid second click) would otherwise dismiss
	// two cards in one gesture. Swallow a repeat within the cooldown window.
	const allowDismiss = cooldownGate(350);

	// Like — soft positive taste signal. Reversible, mutually exclusive with
	// dislike, and does NOT advance the feed (redesign §5).
	function handleLike(card: Doc<'knowledgeCards'>) {
		if (!deviceId) return;
		if (likedIds.has(card._id)) {
			likedIds.delete(card._id); // tapping again un-likes
		} else {
			likedIds.add(card._id);
			dislikedIds.delete(card._id);
			notInterested.delete(card._id);
			track('like', { cardId: card._id });
		}
		scheduleAdapt();
	}

	// Dislike — soft negative; absorbs the old "not interested" (redesign §5). It
	// hides the card optimistically AND advances to the next one.
	function handleDislike(card: Doc<'knowledgeCards'>) {
		if (!allowDismiss()) return;
		if (dislikedIds.has(card._id)) {
			// Reversible: a second tap clears the dislike and keeps the card.
			dislikedIds.delete(card._id);
			notInterested.delete(card._id);
			scheduleAdapt();
			return;
		}
		dislikedIds.add(card._id);
		likedIds.delete(card._id);
		notInterested.add(card._id); // optimistic hide; recompute makes it durable
		track('dislike', { cardId: card._id });
		scheduleAdapt();
		scrollByViewport(1); // dislike advances; like does not
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
			if (fresh.length > 0) {
				injectedAfter.set(card._id, fresh);
				scheduleAdapt();
				await tick();
				scrollByViewport(1);
			}
			// Empty result: do nothing — tapping again is harmless.
		} catch (err) {
			// A rate-limited dive is silently dropped; genuine failures are logged.
			if (!isRateLimited(err)) console.error('[feed] more-like-this failed', err);
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
					handleDislike(active);
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
<svelte:head><title>Wonderwell</title></svelte:head>

{#if showOnboarding && deviceId}
	<OnboardingSheet
		{deviceId}
		onDone={() => {
			markOnboarded();
			showOnboarding = false;
		}}
	/>
{/if}

<!-- Scrim behind the fixed top controls: card images/titles read as sliding
     *under* the chrome instead of colliding with the pills' negative space. -->
<div class="feed-topscrim" aria-hidden="true"></div>

<!-- Two icon affordances, right-aligned (spec §10: account chrome top-right). Search
     (the feed's only text-query surface) and Account — the saved collection lives
     behind the account avatar (spec §5), so it isn't a separate top-level entry. -->
<nav class="feed-nav">
	<a
		class="nav-pill nav-icon"
		href={resolve('/search')}
		aria-label="Search"
		title="Search"
		data-testid="search-link"
	>
		<svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
			<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8" />
			<path
				d="M16 16l4 4"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
			/>
		</svg>
		<span class="vh">Search</span>
	</a>
	<a
		class="nav-pill nav-icon"
		href={resolve('/account')}
		aria-label="Account"
		title="Account"
		data-testid="account-link"
	>
		<svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
			<circle cx="12" cy="8" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8" />
			<path
				d="M5.5 19.5a6.5 6.5 0 0 1 13 0"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
			/>
		</svg>
		<span class="vh">Account</span>
	</a>
</nav>

{#if !online}
	<div class="offline-banner" role="status">
		Offline{offlineFallback ? ' — showing saved-for-offline cards' : ''}
	</div>
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
	{:else if liveFeed.isLoading && orderedCards.length === 0}
		<section class="state">Loading…</section>
	{:else if orderedCards.length === 0}
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
					data-card-id={card._id}
					use:dwell={{
						cardId: card._id,
						body: card.body,
						onActive: (id) => (activeCardId = id),
						onComplete: (id) => handleComplete(id)
					}}
				>
					<Card
						{card}
						following={followedSlugs.has(toSlug(card.source.articleTitle))}
						onLike={online ? () => handleLike(card) : undefined}
						onFollow={online ? () => toggleFollow(card) : undefined}
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
				<h2>You're caught up</h2>
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
		liked={likedIds.has(activeCard._id)}
		onLike={() => handleLike(activeCard)}
		disliked={dislikedIds.has(activeCard._id)}
		onDislike={() => handleDislike(activeCard)}
		saved={savedSet.has(activeCard._id)}
		onSave={() => handleSave(activeCard)}
		onShare={() => handleShare(activeCard)}
		justCopied={shareCopied}
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
