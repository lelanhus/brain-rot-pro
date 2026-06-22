import { render } from 'vitest-browser-svelte';
import { expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import CardActions from './CardActions.svelte';
// The button sizing lives in the global stylesheet (the component is markup
// only), so pull it in to assert the rendered tap-target dimensions.
import '../../app.css';

test('fires save and not-interested handlers; reflects saved state in the label', async () => {
	const onSave = vi.fn();
	const onNotInterested = vi.fn();
	render(CardActions, { saved: false, onSave, following: false, onFollow: vi.fn(), onNotInterested });

	const save = page.getByRole('button', { name: 'Save' });
	await expect.element(save).toBeInTheDocument();
	await save.click();
	expect(onSave).toHaveBeenCalledOnce();

	const notInterested = page.getByRole('button', { name: 'Not interested' });
	await notInterested.click();
	expect(onNotInterested).toHaveBeenCalledOnce();
});

test('shows a saved label when saved', async () => {
	render(CardActions, { saved: true, onSave: () => {}, following: false, onFollow: () => {}, onNotInterested: () => {} });
	await expect.element(page.getByRole('button', { name: /Saved/ })).toBeInTheDocument();
});

// The floating buttons must stay a comfortable tap target (ui-ux.md §4: ≥44px)
// without ballooning so large they overlap the card text on a phone — the bug
// this guards. Sizing is viewport-driven (smaller on phones), so check both.
test('action buttons are a ≥44px tap target and shrink on phone widths', async () => {
	render(CardActions, { saved: false, onSave: () => {}, following: false, onFollow: () => {}, onNotInterested: () => {} });
	const save = page.getByRole('button', { name: 'Save' }).element() as HTMLElement;

	await page.viewport(1280, 800);
	const desktop = save.getBoundingClientRect();
	expect(desktop.width).toBe(56);

	await page.viewport(390, 844); // iPhone-class phone
	const phone = save.getBoundingClientRect();
	expect(phone.width).toBe(48);
	// Never below the accessibility floor, on any screen.
	expect(phone.width).toBeGreaterThanOrEqual(44);
	expect(phone.width).toBe(phone.height); // square target
});
