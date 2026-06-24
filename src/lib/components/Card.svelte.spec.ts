import { render } from 'vitest-browser-svelte';
import { expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import Card from './Card.svelte';
import type { Doc } from '$convex/_generated/dataModel';

// Hoisted so assertions get a non-optional `string` (whyItMatters is optional on Doc).
const WHY = 'It scrambles the mental timeline.';
const SOURCE_SPAN = 'There is evidence of teaching at Oxford as early as 1096.';

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
		sourceSpan: SOURCE_SPAN
	},
	status: 'published',
	shuffleKey: 0.5,
	createdAt: 0
} as unknown as Doc<'knowledgeCards'>;

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

test('renders a full-bleed image as the card face when present', async () => {
	render(Card, { card: withImage });
	await expect.element(page.getByRole('img', { name: sample.hook })).toBeInTheDocument();
});

test('omits the image element when the card has none', async () => {
	render(Card, { card: sample });
	await expect.element(page.getByRole('img')).not.toBeInTheDocument();
});

test('the hook and the "why it matters" payoff are legible on the face with zero taps', async () => {
	render(Card, { card: withImage });
	await expect.element(page.getByRole('heading', { name: sample.hook })).toBeVisible();
	await expect.element(page.getByText(WHY)).toBeVisible(); // payoff is on the face now
});

test('reflects the stored scrim level on the face for the legibility stack', async () => {
	const heavy = {
		...withImage,
		image: { ...withImage.image, scrim: 'heavy' }
	} as unknown as Doc<'knowledgeCards'>;
	render(Card, { card: heavy });
	const face = document.querySelector('.card-face') as HTMLElement;
	expect(face.getAttribute('data-scrim')).toBe('heavy');
});

test('defaults to the medium scrim when the level is unknown', async () => {
	render(Card, { card: withImage }); // no scrim field
	const face = document.querySelector('.card-face') as HTMLElement;
	expect(face.getAttribute('data-scrim')).toBe('medium');
});

test('single tap opens the depth sheet (source + body) and fires onExpand once; grip closes it', async () => {
	let expands = 0;
	render(Card, { card: withImage, onExpand: () => (expands += 1) });

	// Sheet content (the source quote/link) is absent until opened.
	await expect.element(page.getByText(SOURCE_SPAN)).not.toBeInTheDocument();

	await page.getByRole('article').click(); // single tap anywhere on the card
	await expect.element(page.getByText(SOURCE_SPAN)).toBeVisible();
	await expect.element(page.getByRole('link', { name: /Wikipedia/ })).toBeVisible();
	expect(expands).toBe(1);

	await page.getByRole('button', { name: 'Close details' }).click(); // grip
	await expect.element(page.getByText(SOURCE_SPAN)).not.toBeInTheDocument();
	expect(expands).toBe(1); // closing does not re-fire the deepening signal
});

test('concept chips live in the sheet and re-rank via onRelated without closing it', async () => {
	const tags: string[] = [];
	render(Card, { card: withImage, onRelated: (t: string) => tags.push(t) });

	await page.getByRole('article').click();
	await expect.element(page.getByText(SOURCE_SPAN)).toBeVisible();
	await page.getByRole('button', { name: 'Oxford' }).click(); // a conceptTag chip
	expect(tags).toEqual(['Oxford']);
	await expect.element(page.getByText(SOURCE_SPAN)).toBeVisible(); // chip tap did NOT close the sheet
});

test('the Topic + Follow row lives in the sheet and toggles follow', async () => {
	const onFollow = vi.fn();
	render(Card, { card: withImage, following: false, onFollow });
	await page.getByRole('article').click();
	await page.getByRole('button', { name: /follow/i }).click();
	expect(onFollow).toHaveBeenCalledOnce();
});

test('double-tap likes without opening the sheet', async () => {
	let likes = 0;
	let expands = 0;
	render(Card, { card: withImage, onLike: () => (likes += 1), onExpand: () => (expands += 1) });

	await page.getByRole('article').dblClick();
	expect(likes).toBe(1);
	await expect.element(page.getByText(SOURCE_SPAN)).not.toBeInTheDocument(); // sheet stayed closed
	expect(expands).toBe(0);
});
