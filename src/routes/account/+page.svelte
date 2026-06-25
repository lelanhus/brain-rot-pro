<script lang="ts">
	import { resolve } from '$app/paths';
	import { useQuery, useMutation, useAuth, getConvexClient } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import { deviceSession } from '$lib/deviceSession.svelte';
	import { authClient } from '$lib/auth-client';
	import { errorMessage } from '$lib/errors';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	const deviceId = $derived(deviceSession.deviceId);

	const stats = useQuery(api.stats.get, () => (deviceId ? { deviceId } : 'skip'));
	const savedIds = useQuery(api.saved.savedIds, () => (deviceId ? { deviceId } : 'skip'));
	const savedCount = $derived((savedIds.data ?? []).length);
	const s = $derived(stats.data);

	const interests = useQuery(api.interests.list, () => (deviceId ? { deviceId } : 'skip'));
	const removeInterest = useMutation(api.interests.remove);

	// Delete-my-data (two-step confirm) — the account-level data-erase action.
	let confirmingDelete = $state(false);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);

	async function deleteData() {
		if (deleting) return;
		deleting = true;
		deleteError = null;
		try {
			await getConvexClient().mutation(api.account.deleteData, { deviceId });
			// Sign out so the next load mints a fresh anonymous session (B1: identity
			// is the session, not a localStorage id we can clear).
			await authClient.signOut().catch(() => {});
			location.assign(resolve('/'));
		} catch (err) {
			deleteError = errorMessage(err, 'Could not delete your data.');
			deleting = false;
		}
	}

	// Google sign-in (cross-device identity). Anonymous browsing stays the default;
	// signing in merges this device's data into the account server-side (the
	// anonymous plugin's onLinkAccount in convex/auth.ts).
	const auth = useAuth();
	let signingOut = $state(false);
	function signInGoogle() {
		void authClient.signIn.social({ provider: 'google' });
	}
	async function signOut() {
		if (signingOut) return;
		signingOut = true;
		// Next load mints a fresh anonymous session (B1).
		await authClient.signOut();
		location.assign(resolve('/'));
	}

	const num = (n: number) => n.toLocaleString();
</script>

<svelte:head><title>Account</title></svelte:head>

<main class="account">
	<header>
		<a class="back" href={resolve('/')}>← Feed</a>
		<h1>Account</h1>
		<p class="lede">
			Your saves, streak, and personalized feed live on this device, anonymously — no login needed.
		</p>
	</header>

	<section class="panel">
		<h2>Your stats</h2>
		<dl class="stats">
			<div>
				<dt>Current streak</dt>
				<dd>{num(s?.currentStreak ?? 0)}d</dd>
			</div>
			<div>
				<dt>Longest streak</dt>
				<dd>{num(s?.longestStreak ?? 0)}d</dd>
			</div>
			<div>
				<dt>Days learned</dt>
				<dd>{num(s?.daysLearned ?? 0)}</dd>
			</div>
			<div>
				<dt>Saved</dt>
				<dd>{num(savedCount)}</dd>
			</div>
		</dl>
		<a class="row-link" href={resolve('/saved')}>View saved cards →</a>
	</section>

	<section class="panel">
		<h2>Appearance</h2>
		<p>Choose a theme, or follow your device setting.</p>
		<ThemeToggle />
	</section>

	<section class="panel">
		<h2>Cross-device sync</h2>
		{#if auth.isAuthenticated}
			<p>You're signed in with Google — your saves, streak, and feed follow you across devices.</p>
			<button type="button" class="ghost" onclick={signOut} disabled={signingOut}>
				{signingOut ? 'Signing out…' : 'Sign out'}
			</button>
		{:else}
			<p>
				Sign in with Google to sync your saves, streak, and personalized feed across your devices.
			</p>
			<button type="button" class="ghost" onclick={signInGoogle}>Sign in with Google</button>
		{/if}
	</section>

	<section class="panel">
		<h2>Interests</h2>
		{#if (interests.data ?? []).length === 0}
			<p>Follow topics from the feed to personalize what you see.</p>
		{:else}
			<ul class="interests">
				{#each interests.data ?? [] as i (i.slug)}
					<li>
						<span>{i.title}</span>
						<button
							type="button"
							class="ghost"
							onclick={() => deviceId && removeInterest({ deviceId, slug: i.slug })}>Remove</button
						>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="panel danger">
		<h2>Delete my data</h2>
		<p>Permanently erase this account's saves, streak, and history. This can't be undone.</p>
		{#if confirmingDelete}
			<div class="confirm">
				<button type="button" class="destructive" onclick={deleteData} disabled={deleting}>
					{deleting ? 'Deleting…' : 'Yes, delete everything'}
				</button>
				<button type="button" class="ghost" onclick={() => (confirmingDelete = false)}
					>Cancel</button
				>
			</div>
		{:else}
			<button type="button" class="ghost danger-trigger" onclick={() => (confirmingDelete = true)}>
				Delete my data
			</button>
		{/if}
		{#if deleteError}<p class="err">{deleteError}</p>{/if}
	</section>
</main>

<style>
	.account {
		max-width: 560px;
		margin: 0 auto;
		padding: calc(env(safe-area-inset-top) + 1.5rem) 1.25rem
			calc(env(safe-area-inset-bottom) + 4rem);
	}
	header {
		margin-bottom: 1.75rem;
	}
	.back {
		color: var(--muted);
		font-size: 0.9rem;
		text-decoration: none;
	}
	.back:hover {
		color: var(--text);
	}
	h1 {
		margin: 0.35rem 0 0.5rem;
		font-size: 1.4rem;
	}
	.lede {
		color: var(--muted);
		line-height: 1.55;
		margin: 0;
	}
	.panel {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem;
		margin-bottom: 1rem;
	}
	.panel h2 {
		font-size: 1.05rem;
		margin: 0 0 0.35rem;
	}
	.panel p {
		color: var(--muted);
		line-height: 1.5;
		margin: 0 0 0.9rem;
		font-size: 0.92rem;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
		margin: 0 0 1rem;
	}
	.stats div {
		background: var(--surface-2);
		border-radius: var(--radius);
		padding: 0.75rem 0.9rem;
	}
	.stats dt {
		font-size: 0.72rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.stats dd {
		margin: 0.2rem 0 0;
		font-size: 1.5rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.row-link {
		display: inline-block;
		color: var(--accent);
		font-weight: 600;
		font-size: 0.92rem;
		text-decoration: none;
	}
	.row-link:hover {
		text-decoration: underline;
	}
	button {
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		border-radius: var(--radius-sm);
		padding: 0.55rem 1.1rem;
		transition: opacity var(--dur-fast) var(--ease);
	}
	button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.ghost {
		color: var(--text);
		background: transparent;
		border: 1px solid var(--border);
	}
	.panel.danger {
		border-color: color-mix(in srgb, var(--negative) 30%, var(--border));
	}
	.confirm {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.danger-trigger:hover {
		color: var(--negative);
		border-color: var(--negative);
	}
	.destructive {
		color: #fff;
		background: var(--negative);
		border: 1px solid var(--negative);
	}
	.err {
		color: var(--negative) !important;
	}
	.interests {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.interests li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--border);
		font-size: 0.92rem;
	}
	.interests li:last-child {
		border-bottom: none;
	}
	@media (min-width: 700px) {
		.stats {
			grid-template-columns: repeat(4, 1fr);
		}
	}
</style>
