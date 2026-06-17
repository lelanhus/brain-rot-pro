<script lang="ts">
	import { useQuery, useMutation } from 'convex-svelte';
	import { ConvexError } from 'convex/values';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { adminAuth } from '$lib/admin.svelte';

	// Admin: manage sponsored "Go deeper" offers and see CTR (ADR-008, phase B).
	// No SSR — internal tool, gated by the /admin layout + server-side assertAdmin.
	const report = useQuery(api.affiliate.report, () => ({ token: adminAuth.token }));
	const rows = $derived(report.data?.offers ?? []);
	const totals = $derived(report.data?.totals);
	// A rejected token surfaces as a ConvexError; offer to re-enter it.
	const unauthorized = $derived(
		report.error instanceof ConvexError &&
			(report.error.data as { code?: string })?.code === 'unauthorized'
	);

	const add = useMutation(api.affiliate.add);
	const setStatus = useMutation(api.affiliate.setStatus);

	type Network = 'bookshop' | 'amazon' | 'course' | 'direct';

	let headline = $state('');
	let blurb = $state('');
	let url = $state('');
	let tags = $state('');
	let cta = $state('');
	let network = $state<Network>('bookshop');
	let message = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);
	let saving = $state(false);

	const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

	async function onAdd(e: SubmitEvent) {
		e.preventDefault();
		const conceptTags = tags
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
		if (conceptTags.length === 0) {
			message = { kind: 'err', text: 'Add at least one concept tag (comma-separated).' };
			return;
		}
		saving = true;
		message = null;
		try {
			await add({
				token: adminAuth.token,
				headline,
				blurb,
				url,
				conceptTags,
				network,
				cta: cta.trim() || undefined
			});
			message = { kind: 'ok', text: `Added “${headline}”.` };
			headline = blurb = url = tags = cta = '';
		} catch (err) {
			message = { kind: 'err', text: err instanceof Error ? err.message : 'Failed to add offer.' };
		} finally {
			saving = false;
		}
	}

	async function toggleStatus(offerId: Id<'affiliateOffers'>, current: 'active' | 'paused') {
		try {
			await setStatus({
				token: adminAuth.token,
				offerId,
				status: current === 'active' ? 'paused' : 'active'
			});
		} catch (err) {
			console.error('[admin/offers] setStatus failed', err);
		}
	}
</script>

<svelte:head><title>Sponsored offers</title></svelte:head>

<main class="admin">
	<header>
		<h1>Sponsored offers</h1>
	</header>

	<section class="add">
		<h2>Add an offer</h2>
		<p class="hint">
			Paste an affiliate link (e.g. a Bookshop.org book) and the concepts it's relevant to. It
			appears in the feed next to cards sharing those tags.
		</p>
		<form onsubmit={onAdd}>
			<label>
				Headline
				<input bind:value={headline} required maxlength="80" placeholder="Engineering an Empire" />
			</label>
			<label>
				Blurb
				<input
					bind:value={blurb}
					maxlength="160"
					placeholder="How Rome built infrastructure that still stands."
				/>
			</label>
			<label>
				Affiliate URL
				<input bind:value={url} required type="url" placeholder="https://bookshop.org/a/.../..." />
			</label>
			<label>
				Concept tags (comma-separated)
				<input bind:value={tags} required placeholder="rome, engineering" />
			</label>
			<div class="row">
				<label>
					Network
					<select bind:value={network}>
						<option value="bookshop">Bookshop.org</option>
						<option value="amazon">Amazon</option>
						<option value="course">Course</option>
						<option value="direct">Direct</option>
					</select>
				</label>
				<label>
					CTA (optional)
					<input bind:value={cta} maxlength="40" placeholder="Learn more" />
				</label>
			</div>
			<button type="submit" class="primary" disabled={saving}>
				{saving ? 'Adding…' : 'Add offer'}
			</button>
		</form>
		{#if message}
			<p class="msg {message.kind}">{message.text}</p>
		{/if}
	</section>

	<section class="report">
		<h2>Performance</h2>
		{#if unauthorized}
			<p class="msg err">
				Token rejected.
				<button type="button" class="link" onclick={() => adminAuth.clear()}>Re-enter token</button>
			</p>
		{:else if report.error}
			<p class="msg err">{report.error.message}</p>
		{:else if report.isLoading}
			<p class="hint">Loading…</p>
		{:else if rows.length === 0}
			<p class="hint">No offers yet. Add one above.</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th>Offer</th>
						<th>Network</th>
						<th class="num">Impr.</th>
						<th class="num">Clicks</th>
						<th class="num">CTR</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.offerId)}
						<tr class:paused={r.status === 'paused'}>
							<td>{r.headline}</td>
							<td>{r.network}</td>
							<td class="num">{r.impressions}</td>
							<td class="num">{r.clicks}</td>
							<td class="num">{pct(r.ctr)}</td>
							<td>
								<button type="button" onclick={() => toggleStatus(r.offerId, r.status)}>
									{r.status === 'active' ? 'Pause' : 'Activate'}
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
				{#if totals}
					<tfoot>
						<tr>
							<td colspan="2">Total</td>
							<td class="num">{totals.impressions}</td>
							<td class="num">{totals.clicks}</td>
							<td class="num">{pct(totals.ctr)}</td>
							<td></td>
						</tr>
					</tfoot>
				{/if}
			</table>
		{/if}
	</section>
</main>

<style>
	.admin {
		max-width: 760px;
		margin: 0 auto;
		padding: 1.5rem 1.25rem 4rem;
	}
	header {
		margin-bottom: 1.5rem;
	}
	h1 {
		margin: 0;
		font-size: 1.4rem;
	}
	h2 {
		font-size: 1.1rem;
		margin: 0 0 0.5rem;
	}
	section {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.1rem;
		margin-bottom: 1.25rem;
	}
	.hint {
		color: var(--muted);
		font-size: 0.9rem;
		margin: 0 0 0.85rem;
		line-height: 1.5;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.row {
		display: flex;
		gap: 0.75rem;
	}
	.row label {
		flex: 1;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.82rem;
		color: var(--muted);
	}
	input,
	select {
		font: inherit;
		padding: 0.5rem 0.65rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
	}
	button {
		font: inherit;
		padding: 0.45rem 0.9rem;
		border-radius: 8px;
		cursor: pointer;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-2);
	}
	.primary {
		align-self: flex-start;
		background: var(--accent);
		color: #06281c;
		border-color: var(--accent);
		font-weight: 600;
	}
	.primary:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.msg {
		margin: 0.75rem 0 0;
		font-size: 0.9rem;
	}
	.msg.ok {
		color: var(--positive);
	}
	.msg.err {
		color: var(--negative);
	}
	.link {
		font: inherit;
		color: var(--accent);
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		text-decoration: underline;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.5rem 0.4rem;
		border-bottom: 1px solid var(--border);
	}
	th.num,
	td.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	tr.paused td {
		color: var(--muted);
	}
	tfoot td {
		font-weight: 600;
		border-bottom: none;
	}
</style>
