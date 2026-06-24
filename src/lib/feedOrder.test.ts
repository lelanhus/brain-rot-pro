import { expect, test } from 'vitest';
import { mergeStableOrder } from './feedOrder';

test('first load (reset) adopts the incoming order', () => {
	expect(mergeStableOrder([], ['a', 'b', 'c'], true)).toEqual(['a', 'b', 'c']);
});

test('a passive re-rank freezes shown cards and appends only new ones', () => {
	// Reader has scrolled through a..e. A re-rank collapses the live query back to
	// a reranked first page [c, a, f, g]. Already-shown a..e must keep their
	// positions; only the genuinely new f, g append at the end.
	const prev = ['a', 'b', 'c', 'd', 'e'];
	const incoming = ['c', 'a', 'f', 'g'];
	expect(mergeStableOrder(prev, incoming)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
});

test('a transient empty/collapsed page never wipes what is on screen', () => {
	const prev = ['a', 'b', 'c'];
	expect(mergeStableOrder(prev, [])).toEqual(['a', 'b', 'c']);
});

test('reordered incoming with no new ids leaves the frozen order untouched', () => {
	const prev = ['a', 'b', 'c'];
	expect(mergeStableOrder(prev, ['c', 'b', 'a'])).toEqual(['a', 'b', 'c']);
});

test('reset adopts a reordered set wholesale (explicit focus re-rank)', () => {
	const prev = ['a', 'b', 'c'];
	expect(mergeStableOrder(prev, ['c', 'b', 'a'], true)).toEqual(['c', 'b', 'a']);
});

test('appends preserve incoming rank order and dedupe', () => {
	expect(mergeStableOrder(['a'], ['a', 'b', 'b', 'c'])).toEqual(['a', 'b', 'c']);
});
