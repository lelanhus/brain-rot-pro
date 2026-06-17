import { render } from 'vitest-browser-svelte';
import { expect, test, afterEach } from 'vitest';
import { page } from 'vitest/browser';
import ThemeToggle from './ThemeToggle.svelte';

afterEach(() => {
	// Reset so a forced theme doesn't bleed into other component tests.
	document.documentElement.removeAttribute('data-theme');
	localStorage.removeItem('brp_theme');
});

test('offers System / Light / Dark and applies the choice to <html>', async () => {
	render(ThemeToggle);
	await expect.element(page.getByRole('button', { name: 'System' })).toBeInTheDocument();

	const light = page.getByRole('button', { name: 'Light' });
	await light.click();
	await expect.element(light).toHaveAttribute('aria-pressed', 'true');
	expect(document.documentElement.dataset.theme).toBe('light');

	// Choosing System clears the forced attribute (falls back to prefers-color-scheme).
	await page.getByRole('button', { name: 'System' }).click();
	expect(document.documentElement.dataset.theme).toBeUndefined();
});
