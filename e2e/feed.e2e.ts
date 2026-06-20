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

// Reveal overlay: opening "why it matters" must not introduce scroll on the slot.
// Gated like the other SSR tests (needs live Convex + seeded cards).
test.describe('feed (reveal overlay)', () => {
	test.skip(!process.env.E2E_LIVE, 'requires a live Convex deployment (set E2E_LIVE=1)');

	test('opening "why it matters" does not introduce scroll', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto('/');
		await expect(page.locator('.slot').first()).toBeVisible();
		const slot = page.locator('.slot').first();
		await page.getByRole('button', { name: 'Why it matters' }).first().click();
		const overflow = await slot.evaluate((s) => s.scrollHeight - s.clientHeight);
		expect(overflow).toBeLessThanOrEqual(1);
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

	// Guards the silent-clip failure mode: overflow:hidden on .slot hides controls
	// without producing scroll. Asserts that both in-card toggle buttons are visible
	// and their bounding boxes sit within the first slot's client rect at 375×667.
	test('in-card toggles (Why / Source) are within the first slot at 375×667', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto('/');
		await expect(page.locator('.slot').first()).toBeVisible();

		const slotBox = await page.locator('.slot').first().boundingBox();
		expect(slotBox).not.toBeNull();

		const whyToggle = page.getByRole('button', { name: /why it matters/i }).first();
		const sourceToggle = page.getByRole('button', { name: /source/i }).first();

		await expect(whyToggle).toBeVisible();
		await expect(sourceToggle).toBeVisible();

		const whyBox = await whyToggle.boundingBox();
		const sourceBox = await sourceToggle.boundingBox();

		expect(whyBox).not.toBeNull();
		expect(sourceBox).not.toBeNull();

		// Both toggles must sit within the slot's vertical bounds.
		expect(whyBox!.y).toBeGreaterThanOrEqual(slotBox!.y);
		expect(whyBox!.y + whyBox!.height).toBeLessThanOrEqual(slotBox!.y + slotBox!.height);
		expect(sourceBox!.y).toBeGreaterThanOrEqual(slotBox!.y);
		expect(sourceBox!.y + sourceBox!.height).toBeLessThanOrEqual(slotBox!.y + slotBox!.height);
	});
});
