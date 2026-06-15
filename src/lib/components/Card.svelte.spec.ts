import { render } from 'vitest-browser-svelte';
import { expect, test } from 'vitest';
import { page } from 'vitest/browser';
import Card from './Card.svelte';
import type { Doc } from '$convex/_generated/dataModel';

const sample = {
	_id: 'card_1',
	_creationTime: 0,
	hook: 'Oxford is older than the Aztec Empire.',
	body: 'Teaching at Oxford dates to 1096, before the Aztec capital was founded in 1325.',
	whyItMatters: 'It scrambles the mental timeline.',
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
