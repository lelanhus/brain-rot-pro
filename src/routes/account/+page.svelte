<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { useQuery, getConvexClient } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import { getDeviceId, clearDeviceId } from '$lib/identity';
	import { errorMessage } from '$lib/errors';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let deviceId = $state('');
	onMount(() => {
		deviceId = getDeviceId();
	});

	const stats = useQuery(api.stats.get, () => (deviceId ? { deviceId } : 'skip'));
	const savedIds = useQuery(api.saved.savedIds, () => (deviceId ? { deviceId } : 'skip'));
	const savedCount = $derived((savedIds.data ?? []).length);
	const s = $derived(stats.data);

	// Delete-my-data (two-step confirm) — the account-level action, relocated here
	// from /sync so /sync is purely device pairing.
	let confirmingDelete = $state(false);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);

	async function deleteData() {
		if (deleting) return;
		deleting = true;
		deleteError = null;
		try {
			await getConvexClient().mutation(api.account.deleteData, { deviceId });
			clearDeviceId(); // next visit starts fresh
			location.assign(resolve('/'));
		} catch (err) {
			deleteError = errorMessage(err, 'Could not delete your data.');
			deleting = false;
		}
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
		<h2>Devices</h2>
		<p>Carry your saves and streak to another device with a one-time code.</p>
		<a class="row-link" href={resolve('/sync')}>Sync to another device →</a>
		<p class="note">
			Google &amp; Apple sign-in for automatic cross-device sync is coming. Until then, anonymous
			device sync keeps everything on your devices and off our servers.
		</p>
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
	.note {
		margin: 0.9rem 0 0 !important;
		font-size: 0.82rem !important;
	}
	button {
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		border-radius: 999px;
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
	@media (min-width: 700px) {
		.stats {
			grid-template-columns: repeat(4, 1fr);
		}
	}
</style>
