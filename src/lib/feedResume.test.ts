import { describe, expect, test } from 'vitest';
import type { Doc } from '$convex/_generated/dataModel';
import { buildResume, canResume, resumeIndex } from './feedResume';

// Only `_id` matters to the resume logic.
const card = (id: string) => ({ _id: id }) as unknown as Doc<'knowledgeCards'>;
const cards = (...ids: string[]) => ids.map(card);

describe('buildResume', () => {
	test('returns null without a device id or any cards', () => {
		expect(buildResume('', 'a', cards('a', 'b'))).toBeNull();
		expect(buildResume('dev', 'a', [])).toBeNull();
	});

	test('keeps the top through a small buffer past the active card', () => {
		const snap = buildResume('dev', 'c', cards('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'));
		// top→active (a,b,c) + 3-card prefetch buffer (d,e,f); g,h re-stream on return.
		expect(snap?.cards.map((c) => c._id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
		expect(snap?.activeId).toBe('c');
		expect(snap?.deviceId).toBe('dev');
	});

	test('caps the window, dropping the oldest top cards', () => {
		const many = cards(...Array.from({ length: 100 }, (_, i) => `c${i}`));
		const snap = buildResume('dev', 'c80', many, 10);
		expect(snap?.cards).toHaveLength(10);
		// window ends at active+3 (c83); the last 10 of c0..c83 → c74..c83.
		expect(snap?.cards.at(-1)?._id).toBe('c83');
		expect(snap?.cards[0]?._id).toBe('c74');
	});

	test('with no active card, keeps from the top (capped)', () => {
		const snap = buildResume('dev', null, cards('a', 'b', 'c'));
		expect(snap?.cards.map((c) => c._id)).toEqual(['a', 'b', 'c']);
	});

	test('with an unknown active id, keeps everything (capped)', () => {
		const snap = buildResume('dev', 'zzz', cards('a', 'b', 'c'));
		expect(snap?.cards.map((c) => c._id)).toEqual(['a', 'b', 'c']);
	});
});

describe('canResume', () => {
	test('true only when the snapshot matches the device and has cards', () => {
		const snap = buildResume('dev', 'a', cards('a', 'b'));
		expect(canResume(snap, 'dev')).toBe(true);
		expect(canResume(snap, 'other')).toBe(false);
		expect(canResume(null, 'dev')).toBe(false);
	});
});

describe('resumeIndex', () => {
	test('locates the active card in the order, else falls back to the top', () => {
		expect(resumeIndex(['a', 'b', 'c'], 'b')).toBe(1);
		expect(resumeIndex(['a', 'b', 'c'], 'zzz')).toBe(0);
		expect(resumeIndex(['a', 'b', 'c'], null)).toBe(0);
	});
});
