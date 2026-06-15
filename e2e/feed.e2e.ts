import { expect, test } from '@playwright/test';

// This exercises the real SSR-to-live feed and therefore needs a live Convex
// deployment with seeded cards + PUBLIC_CONVEX_URL set. Enable with E2E_LIVE=1
// once `npx convex dev` is running (acceptance-criteria.md Phase 0).
test.skip(!process.env.E2E_LIVE, 'requires a live Convex deployment (set E2E_LIVE=1)');

test('feed renders source-backed cards', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByTestId('feed')).toBeVisible();
	await expect(page.getByRole('article').first()).toBeVisible();
	await expect(page.getByRole('heading').first()).toBeVisible();
	await page.screenshot({ path: 'feed-screenshot.png' });
});
