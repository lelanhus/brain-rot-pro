import { expect, test } from 'vitest';
import { capCards, persistCards, readCards, type OfflineCard } from './offlineFeed';

// Named *.svelte.test.ts so it runs in the browser project (IndexedDB available),
// not the node `server` project.

const card = (id: string, hook: string): OfflineCard =>
	({
		_id: id,
		_creationTime: 0,
		hook,
		body: 'b',
		format: 'surprise_fact',
		conceptTags: [],
		source: { articleTitle: 't', articleUrl: 'u', revisionId: null, sourceSpan: 's' },
		status: 'published',
		shuffleKey: 0.5,
		createdAt: 0
	}) as unknown as OfflineCard;

test('capCards bounds the set and preserves order', () => {
	const cards = Array.from({ length: 60 }, (_, i) => card(`c${i}`, `h${i}`));
	const capped = capCards(cards, 50);
	expect(capped).toHaveLength(50);
	expect(capped[0]._id).toBe('c0');
});

test('persistCards → readCards round-trips in feed order', async () => {
	await persistCards([card('a', 'Alpha'), card('b', 'Beta'), card('c', 'Gamma')]);
	const read = await readCards();
	expect(read.map((c) => c._id)).toEqual(['a', 'b', 'c']);
	expect(read[1].hook).toBe('Beta');
});

test('persistCards replaces the previous cache', async () => {
	await persistCards([card('x', 'X'), card('y', 'Y')]);
	await persistCards([card('z', 'Z')]);
	const read = await readCards();
	expect(read.map((c) => c._id)).toEqual(['z']);
});
