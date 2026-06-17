import { describe, expect, it } from 'vitest';
import { bucketByStatus, bucketByType, summarizeAudience, summarizeEngagement } from './adminLogic';
import { dayKey } from './streakLogic';

describe('bucketByType / bucketByStatus', () => {
	it('counts occurrences', () => {
		expect(bucketByType([{ type: 'a' }, { type: 'a' }, { type: 'b' }])).toEqual({ a: 2, b: 1 });
		expect(bucketByStatus([{ status: 'published' }, { status: 'draft' }])).toEqual({
			published: 1,
			draft: 1
		});
	});
});

describe('summarizeEngagement', () => {
	it('computes CCR as continuations / impressions', () => {
		const byType = { card_impression: 10, card_complete: 3, save: 1, card_skip: 5 };
		const s = summarizeEngagement(byType);
		expect(s.impressions).toBe(10);
		expect(s.continuations).toBe(4); // complete + save (skip is not a continuation)
		expect(s.ccr).toBeCloseTo(0.4);
	});
	it('is zero CCR with no impressions', () => {
		expect(summarizeEngagement({ save: 2 }).ccr).toBe(0);
	});
});

describe('summarizeAudience', () => {
	it('counts devices, active-today (UTC), max streak, and average current streak', () => {
		const now = Date.parse('2026-06-17T12:00:00Z');
		const today = dayKey(now);
		const stats = [
			{ currentStreak: 3, longestStreak: 9, lastActiveDay: today },
			{ currentStreak: 1, longestStreak: 1, lastActiveDay: today },
			{ currentStreak: 0, longestStreak: 4, lastActiveDay: '2026-06-10' }
		];
		const a = summarizeAudience(stats, now);
		expect(a.devices).toBe(3);
		expect(a.activeToday).toBe(2);
		expect(a.maxStreak).toBe(9);
		expect(a.avgCurrentStreak).toBeCloseTo((3 + 1 + 0) / 3);
	});
	it('handles an empty user base without dividing by zero', () => {
		expect(summarizeAudience([], Date.now())).toMatchObject({ devices: 0, avgCurrentStreak: 0 });
	});
});
