import { render } from 'vitest-browser-svelte';
import { expect, test } from 'vitest';
import { page } from 'vitest/browser';
import Card from './Card.svelte';
import type { Doc } from '$convex/_generated/dataModel';

// Hoisted so assertions get a non-optional `string` (whyItMatters is optional on Doc).
const WHY = 'It scrambles the mental timeline.';

const sample = {
	_id: 'card_1',
	_creationTime: 0,
	hook: 'Oxford is older than the Aztec Empire.',
	body: 'Teaching at Oxford dates to 1096, before the Aztec capital was founded in 1325.',
	whyItMatters: WHY,
	format: 'timeline_shock',
	conceptTags: ['Oxford', 'history'],
	source: {
		articleTitle: 'University of Oxford',
		articleUrl: 'https://en.wikipedia.org/wiki/University_of_Oxford',
		revisionId: null,
		sourceSpan: 'There is evidence of teaching at Oxford as early as 1096.'
	},
	status: 'published',
	shuffleKey: 0.5,
	createdAt: 0
} as unknown as Doc<'knowledgeCards'>;

test('renders the hook and body, and reveals a source link', async () => {
	render(Card, { card: sample });
	await expect.element(page.getByRole('heading', { name: sample.hook })).toBeInTheDocument();
	await expect.element(page.getByText(sample.body)).toBeInTheDocument();

	// The source link lives behind a disclosure; opening it should reveal it.
	await page.getByText('Source', { exact: true }).click();
	await expect.element(page.getByRole('link', { name: /Wikipedia/ })).toBeVisible();
});

test('omits the image figure when the card has none', async () => {
	render(Card, { card: sample });
	await expect.element(page.getByRole('img')).not.toBeInTheDocument();
});

test('shows "More like this" only when a handler is wired, and fires it', async () => {
	render(Card, { card: sample });
	await expect
		.element(page.getByRole('button', { name: /More like this/ }))
		.not.toBeInTheDocument();

	let dived = false;
	render(Card, { card: sample, onMore: () => (dived = true) });
	const button = page.getByRole('button', { name: /More like this/ });
	await expect.element(button).toBeVisible();
	await button.click();
	expect(dived).toBe(true);
});

test('renders a free-licensed image with attribution when present', async () => {
	const withImage = {
		...sample,
		image: {
			thumbnailUrl: 'https://upload.wikimedia.org/thumb.jpg',
			commonsUrl: 'https://commons.wikimedia.org/wiki/File:Oxford.jpg',
			author: 'Jane Doe',
			licenseShortName: 'CC BY-SA 4.0',
			licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
			attribution: 'Jane Doe, CC BY-SA 4.0, via Wikimedia Commons'
		}
	} as unknown as Doc<'knowledgeCards'>;
	render(Card, { card: withImage });
	await expect.element(page.getByRole('img', { name: sample.hook })).toBeInTheDocument();
	await expect.element(page.getByRole('link', { name: 'Jane Doe' })).toBeVisible();
	await expect.element(page.getByRole('link', { name: 'CC BY-SA 4.0' })).toBeVisible();
});

test('keeps "why it matters" collapsed until the toggle reveals it in the overlay, firing card_expand once', async () => {
	let expands = 0;
	render(Card, { card: sample, onExpand: () => (expands += 1) });

	// Hidden by default so it doesn't compete with the hook (ui-ux.md §3).
	await expect.element(page.getByText(WHY)).not.toBeInTheDocument();

	const toggle = page.getByRole('button', { name: /why it matters/i });
	await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');
	await toggle.click();

	// The text now appears inside the overlay panel (not inline in the card flow).
	// The overlay's close button confirms the panel is rendered (not just the text).
	await expect.element(page.getByText(WHY)).toBeVisible();
	await expect.element(page.getByRole('button', { name: 'Close' })).toBeVisible();
	await expect.element(toggle).toHaveAttribute('aria-expanded', 'true');
	expect(expands).toBe(1);

	// Collapsing again hides the overlay without re-firing the deepening signal.
	await toggle.click();
	await expect.element(page.getByText(WHY)).not.toBeInTheDocument();
	await expect.element(page.getByRole('button', { name: 'Close' })).not.toBeInTheDocument();
	expect(expands).toBe(1);
});
