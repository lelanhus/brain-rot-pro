<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { getConvexClient } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import { getDeviceId, setDeviceId } from '$lib/identity';
	import { formatCodeForDisplay, normalizeCode } from '$convex/syncLogic';

	let deviceId = $state('');
	onMount(() => {
		deviceId = getDeviceId();
	});

	// Show-my-code state.
	let code = $state<string | null>(null);
	let expiresAt = $state(0);
	let minting = $state(false);
	let mintError = $state<string | null>(null);

	// Enter-a-code state.
	let entry = $state('');
	let redeeming = $state(false);
	let redeemError = $state<string | null>(null);
	let redeemed = $state(false);

	const displayCode = $derived(code ? formatCodeForDisplay(code) : '');
	const entryValid = $derived(normalizeCode(entry).length === 8);

	async function mint() {
		if (!deviceId || minting) return;
		minting = true;
		mintError = null;
		try {
			const res = await getConvexClient().mutation(api.sync.createCode, { deviceId });
			code = res.code;
			expiresAt = res.expiresAt;
		} catch (err) {
			mintError = err instanceof Error ? err.message : 'Could not create a code.';
		} finally {
			minting = false;
		}
	}

	async function adopt() {
		if (!entryValid || redeeming) return;
		redeeming = true;
		redeemError = null;
		try {
			const res = await getConvexClient().mutation(api.sync.redeem, { code: entry, deviceId });
			setDeviceId(res.deviceId);
			redeemed = true;
			// Reload so every live query re-subscribes under the adopted account.
			setTimeout(() => location.assign(resolve('/')), 900);
		} catch (err) {
			redeemError = err instanceof Error ? err.message : 'Could not use that code.';
		} finally {
			redeeming = false;
		}
	}

	function minutesLeft(): number {
		return Math.max(0, Math.round((expiresAt - Date.now()) / 60000));
	}
</script>

<svelte:head><title>Sync devices</title></svelte:head>

<main class="sync">
	<header>
		<a class="back" href={resolve('/')}>← Feed</a>
		<h1>Sync devices</h1>
		<p class="lede">
			Your saves, streak, and personalized feed live on this device, anonymously — no account
			needed. To carry them to another device, show a code here and enter it there.
		</p>
	</header>

	<section class="panel">
		<h2>Move this account to another device</h2>
		<p>Open this page on the other device and enter the code below.</p>

		{#if code}
			<div class="code" data-testid="sync-code">{displayCode}</div>
			<p class="hint">Expires in about {minutesLeft()} minutes. Single use.</p>
			<button type="button" class="ghost" onclick={mint} disabled={minting}>New code</button>
		{:else}
			<button type="button" class="primary" onclick={mint} disabled={minting || !deviceId}>
				{minting ? 'Creating…' : 'Show my code'}
			</button>
		{/if}
		{#if mintError}<p class="err">{mintError}</p>{/if}
	</section>

	<section class="panel">
		<h2>Join an account on this device</h2>
		<p>Enter a code from your other device. The two accounts merge into one.</p>

		{#if redeemed}
			<p class="ok">Synced. Taking you to the feed…</p>
		{:else}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					adopt();
				}}
			>
				<input
					type="text"
					inputmode="text"
					autocomplete="one-time-code"
					placeholder="ABCD-2345"
					maxlength="12"
					bind:value={entry}
					aria-label="Sync code"
				/>
				<button type="submit" class="primary" disabled={!entryValid || redeeming}>
					{redeeming ? 'Syncing…' : 'Sync this device'}
				</button>
			</form>
			<p class="hint">
				Your saves and streak on this device will be combined with the other account's.
			</p>
		{/if}
		{#if redeemError}<p class="err">{redeemError}</p>{/if}
	</section>
</main>

<style>
	.sync {
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
	.code {
		font-size: 2rem;
		font-weight: 750;
		letter-spacing: 0.18em;
		text-align: center;
		color: var(--accent);
		background: var(--surface-2);
		border-radius: var(--radius);
		padding: 1rem;
		margin-bottom: 0.6rem;
		font-variant-numeric: tabular-nums;
	}
	.hint {
		font-size: 0.82rem !important;
		color: var(--muted);
	}
	form {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.6rem;
	}
	input {
		flex: 1;
		font: inherit;
		font-size: 1.05rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text);
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.55rem 1rem;
	}
	input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
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
	.primary {
		color: #fff;
		background: var(--accent);
		border: 1px solid var(--accent);
	}
	.ghost {
		color: var(--text);
		background: transparent;
		border: 1px solid var(--border);
	}
	.err {
		color: var(--negative) !important;
	}
	.ok {
		color: var(--positive) !important;
	}
</style>
