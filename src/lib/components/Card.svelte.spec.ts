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

test('keeps "why it matters" collapsed until the toggle reveals it, firing card_expand once', async () => {
	let expands = 0;
	render(Card, { card: sample, onExpand: () => (expands += 1) });

	// Hidden by default so it doesn't compete with the hook (ui-ux.md §3).
	await expect.element(page.getByText(WHY)).not.toBeInTheDocument();

	const toggle = page.getByRole('button', { name: /why it matters/i });
	await toggle.click();
	await expect.element(page.getByText(WHY)).toBeVisible();
	expect(expands).toBe(1);

	// Collapsing again hides it without re-firing the deepening signal.
	await toggle.click();
	await expect.element(page.getByText(WHY)).not.toBeInTheDocument();
	expect(expands).toBe(1);
});
