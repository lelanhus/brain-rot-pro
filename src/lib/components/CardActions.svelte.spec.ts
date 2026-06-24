import { render } from 'vitest-browser-svelte';
import { expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import CardActions from './CardActions.svelte';
// The button sizing lives in the global stylesheet (the component is markup
// only), so pull it in to assert the rendered tap-target dimensions.
import '../../app.css';

const noop = () => {};
const base = {
	liked: false,
	onLike: noop,
	disliked: false,
	onDislike: noop,
	saved: false,
	onSave: noop
};

test('renders like, dislike, save and share, and fires each handler', async () => {
	const onLike = vi.fn();
	const onDislike = vi.fn();
	const onSave = vi.fn();
	const onShare = vi.fn();
	render(CardActions, { ...base, onLike, onDislike, onSave, onShare });

	await page.getByRole('button', { name: 'Like' }).click();
	expect(onLike).toHaveBeenCalledOnce();
	await page.getByRole('button', { name: 'Not interested' }).click();
	expect(onDislike).toHaveBeenCalledOnce();
	await page.getByRole('button', { name: 'Save' }).click();
	expect(onSave).toHaveBeenCalledOnce();
	await page.getByRole('button', { name: 'Share' }).click();
	expect(onShare).toHaveBeenCalledOnce();
});

test('reflects liked / disliked / saved state via aria-pressed and labels', async () => {
	render(CardActions, { ...base, liked: true, disliked: false, saved: true });
	await expect
		.element(page.getByRole('button', { name: /Liked/ }))
		.toHaveAttribute('aria-pressed', 'true');
	await expect
		.element(page.getByRole('button', { name: /Saved/ }))
		.toHaveAttribute('aria-pressed', 'true');
	await expect
		.element(page.getByRole('button', { name: 'Not interested' }))
		.toHaveAttribute('aria-pressed', 'false');
});

// The floating buttons must stay a comfortable tap target (ui-ux.md §4: ≥44px)
// without ballooning so large they overlap the card text on a phone.
test('action buttons are a ≥44px tap target and shrink on phone widths', async () => {
	render(CardActions, base);
	const like = page.getByRole('button', { name: 'Like' }).element() as HTMLElement;

	await page.viewport(1280, 800);
	expect(like.getBoundingClientRect().width).toBe(56);

	await page.viewport(390, 844); // iPhone-class phone
	const phone = like.getBoundingClientRect();
	expect(phone.width).toBe(48);
	expect(phone.width).toBeGreaterThanOrEqual(44);
	expect(phone.width).toBe(phone.height); // square target
});
