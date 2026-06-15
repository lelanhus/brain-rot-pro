import { render } from 'vitest-browser-svelte';
import { expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import CardActions from './CardActions.svelte';

test('fires save and not-interested handlers; reflects saved state in the label', async () => {
	const onSave = vi.fn();
	const onNotInterested = vi.fn();
	render(CardActions, { saved: false, onSave, onNotInterested });

	const save = page.getByRole('button', { name: 'Save' });
	await expect.element(save).toBeInTheDocument();
	await save.click();
	expect(onSave).toHaveBeenCalledOnce();

	const notInterested = page.getByRole('button', { name: 'Not interested' });
	await notInterested.click();
	expect(onNotInterested).toHaveBeenCalledOnce();
});

test('shows a saved label when saved', async () => {
	render(CardActions, { saved: true, onSave: () => {}, onNotInterested: () => {} });
	await expect.element(page.getByRole('button', { name: /Saved/ })).toBeInTheDocument();
});
