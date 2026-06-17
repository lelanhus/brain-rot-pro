import { render } from 'vitest-browser-svelte';
import { expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import SponsoredCard from './SponsoredCard.svelte';
import type { SponsoredOffer } from '$lib/sponsored';

const offer: SponsoredOffer = {
	_id: 'offer_1',
	headline: 'Engineering an Empire',
	blurb: 'How Rome built to last.',
	cta: 'View on Bookshop',
	url: 'https://bookshop.org/a/123/x',
	network: 'bookshop',
	disclosure: 'Affiliate link — we may earn a commission.',
	conceptTags: ['rome'],
	weight: 1
};

test('renders headline, blurb, disclosure and a clearly-labeled sponsored tag', async () => {
	render(SponsoredCard, { offer });
	await expect.element(page.getByRole('heading', { name: offer.headline })).toBeInTheDocument();
	await expect.element(page.getByText(offer.blurb)).toBeInTheDocument();
	await expect.element(page.getByText(offer.disclosure)).toBeInTheDocument();
	await expect.element(page.getByText(/Sponsored/)).toBeInTheDocument();
});

test('CTA is an outbound link marked rel="sponsored" and fires onClick', async () => {
	const onClick = vi.fn();
	render(SponsoredCard, { offer, onClick });
	const link = page.getByRole('link', { name: /View on Bookshop/ });
	await expect.element(link).toHaveAttribute('rel', 'sponsored nofollow noopener noreferrer');
	await expect.element(link).toHaveAttribute('href', offer.url);
	await link.click();
	expect(onClick).toHaveBeenCalledOnce();
});

test('fires one impression when mounted', async () => {
	const onImpression = vi.fn();
	render(SponsoredCard, { offer, onImpression });
	await vi.waitFor(() => expect(onImpression).toHaveBeenCalledOnce());
});

test('dismiss affordance fires onDismiss', async () => {
	const onDismiss = vi.fn();
	render(SponsoredCard, { offer, onDismiss });
	await page.getByRole('button', { name: 'Not interested' }).click();
	expect(onDismiss).toHaveBeenCalledOnce();
});
