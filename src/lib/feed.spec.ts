import { describe, expect, it } from 'vitest';
import { weaveFeed } from './feed';

const card = (id: string) => ({ _id: id });

describe('weaveFeed', () => {
	it('returns the base order unchanged when nothing is injected', () => {
		const base = [card('a'), card('b'), card('c')];
		expect(weaveFeed(base, new Map()).map((c) => c._id)).toEqual(['a', 'b', 'c']);
	});

	it('inserts related cards immediately after their source', () => {
		const base = [card('a'), card('b')];
		const injected = new Map([['a', [card('x'), card('y')]]]);
		expect(weaveFeed(base, injected).map((c) => c._id)).toEqual(['a', 'x', 'y', 'b']);
	});

	it('never duplicates: a related card already in the base moves up to its injected slot', () => {
		const base = [card('a'), card('b'), card('c')];
		const injected = new Map([['a', [card('c')]]]);
		expect(weaveFeed(base, injected).map((c) => c._id)).toEqual(['a', 'c', 'b']);
	});

	it('supports diving from multiple cards', () => {
		const base = [card('a'), card('b')];
		const injected = new Map([
			['a', [card('x')]],
			['b', [card('y')]]
		]);
		expect(weaveFeed(base, injected).map((c) => c._id)).toEqual(['a', 'x', 'b', 'y']);
	});
});
