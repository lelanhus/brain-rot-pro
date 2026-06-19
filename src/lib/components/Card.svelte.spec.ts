import { render } from 'vitest-browser-svelte';
import { expect, test } from 'vitest';
import { page } from 'vitest/browser';
import Card from './Card.svelte';
import type { Doc } from '$convex/_generated/dataModel';
// The one-card-per-screen layout (slot padding, rhythm, image flex) lives in the
// global stylesheet, so load it to measure the rendered card the way the feed does.
import '../../app.css';

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

// A long, real-length card (longest hook + a full body in the seed set) plus an
// image card, each measured inside the actual feed/slot chrome at a phone size.
// Guards the "one idea, one screen" rule (ui-ux.md §1/§3): a regression that
// re-inflates the vertical rhythm (or an unscaled image) would push the card past
// the viewport and force a scroll just to reach the next card.
const longCard = {
	...sample,
	hook: 'Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.',
	body: 'The Great Pyramid of Giza was completed around 2560 BC. Cleopatra died in 30 BC — about 2,500 years later. The Apollo 11 Moon landing was in 1969 AD, roughly 2,000 years after Cleopatra. She was nearer to the spaceflight era than to the pyramids that already felt ancient in her own lifetime.',
	conceptTags: ['Cleopatra', 'Great Pyramid', 'ancient Egypt', 'deep time']
} as unknown as Doc<'knowledgeCards'>;

const imageCard = {
	...longCard,
	image: {
		thumbnailUrl:
			"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600'%3E%3Crect width='800' height='600' fill='%23445'/%3E%3C/svg%3E",
		commonsUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg',
		author: 'Jane Doe',
		licenseShortName: 'CC BY-SA 4.0',
		licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
		attribution: 'Jane Doe, CC BY-SA 4.0, via Wikimedia Commons'
	}
} as unknown as Doc<'knowledgeCards'>;

// Re-parent the rendered card into the real feed/slot wrapper so slot padding and
// the per-slot height rules apply exactly as on the page, then measure.
function measureInSlot() {
	const article = document.querySelector('.card');
	if (!article) throw new Error('card not rendered');
	const feed = document.createElement('main');
	feed.className = 'feed';
	const slot = document.createElement('div');
	slot.className = 'slot';
	feed.appendChild(slot);
	slot.appendChild(article);
	document.body.appendChild(feed);
	return slot;
}

test('a long text card fits within a phone screen (no per-card scroll)', async () => {
	await page.viewport(390, 844);
	render(Card, { card: longCard, onMore: () => {} });
	const slot = measureInSlot();
	expect(slot.scrollHeight).toBeLessThanOrEqual(window.innerHeight + 1);
});

test('an image card scales its image so the card still fits a phone screen', async () => {
	await page.viewport(390, 844);
	render(Card, { card: imageCard, onMore: () => {} });
	const slot = measureInSlot();
	expect(slot.scrollHeight).toBeLessThanOrEqual(window.innerHeight + 1);
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
