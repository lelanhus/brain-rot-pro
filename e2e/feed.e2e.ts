import { expect, test } from '@playwright/test';

// SSR render test: needs a live Convex deployment with seeded cards +
// PUBLIC_CONVEX_URL. Enable with E2E_LIVE=1 (acceptance-criteria Phase 0/1).
// This passes anywhere SSR can reach Convex over HTTPS.
test.describe('feed (SSR)', () => {
	test.skip(!process.env.E2E_LIVE, 'requires a live Convex deployment (set E2E_LIVE=1)');

	test('renders source-backed cards', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByTestId('feed')).toBeVisible();
		await expect(page.getByRole('article').first()).toBeVisible();
		await expect(page.getByRole('heading').first()).toBeVisible();
		await expect(page.getByRole('button', { name: 'Save' }).first()).toBeVisible();
		await page.screenshot({ path: 'feed-screenshot.png' });
	});
});

// Interaction test: depends on the client-side Convex WebSocket (live updates +
// mutations). Some sandboxed/CI browsers can't open it (TLS interception →
// ERR_CERT_AUTHORITY_INVALID), so it's gated separately behind E2E_WS=1. The
// save logic itself is covered by convex-test (saved.toggle/savedIds) and the
// CardActions component test; this is the end-to-end confirmation.
test.describe('feed (interaction, needs WebSocket)', () => {
	test.skip(
		!process.env.E2E_WS,
		'needs a browser that can open the Convex WebSocket (set E2E_WS=1)'
	);

	test('save toggles saved state', async ({ page }) => {
		await page.goto('/');
		const save = page.getByRole('button', { name: 'Save' }).first();
		await expect(save).toBeVisible();
		await save.click();
		await expect(page.getByRole('button', { name: /Saved/ }).first()).toBeVisible();
		await page.screenshot({ path: 'feed-actions-screenshot.png' });
	});
});

// One-screen guarantee: no card scrolls within its slot at the target phone
// sizes. Gated like the other SSR tests (needs live Convex + seeded cards).
test.describe('feed (one-screen fit)', () => {
	test.skip(!process.env.E2E_LIVE, 'requires a live Convex deployment (set E2E_LIVE=1)');

	for (const vp of [
		{ name: 'iPhone SE 2022', width: 375, height: 667 },
		{ name: 'iPhone 14', width: 390, height: 844 }
	]) {
		test(`no in-card scroll at ${vp.name}`, async ({ page }) => {
			await page.setViewportSize({ width: vp.width, height: vp.height });
			await page.goto('/');
			await expect(page.getByTestId('feed')).toBeVisible();
			await expect(page.locator('.slot').first()).toBeVisible();
			const overflow = await page
				.locator('.slot')
				.evaluateAll((slots) =>
					slots.map((s) => s.scrollHeight - s.clientHeight).filter((d) => d > 1)
				);
			expect(overflow).toEqual([]);
		});
	}
});
