import { describe, expect, it } from 'vitest';
import {
	bucketByStatus,
	bucketByType,
	dailyActivity,
	mergeAccountSummaries,
	summarizeAudience,
	summarizeEngagement
} from './adminLogic';
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

describe('mergeAccountSummaries', () => {
	it('unions devices across tables and sorts most-recently-active first', () => {
		const stats = [
			{
				deviceId: 'a',
				currentStreak: 2,
				longestStreak: 5,
				daysLearned: 9,
				lastActiveDay: '2026-06-17'
			},
			{
				deviceId: 'b',
				currentStreak: 0,
				longestStreak: 1,
				daysLearned: 1,
				lastActiveDay: '2026-06-10'
			}
		];
		const profiles = [
			{ deviceId: 'a', conceptWeights: [{}, {}], seen: [{}], notInterested: [{}, {}, {}] }
		];
		const savedCounts = new Map([
			['a', 4],
			['c', 1] // saves only, no stats/profile → still listed
		]);
		const out = mergeAccountSummaries(stats, profiles, savedCounts);
		expect(out.map((r) => r.deviceId)).toEqual(['a', 'b', 'c']);
		expect(out[0]).toMatchObject({
			deviceId: 'a',
			saves: 4,
			concepts: 2,
			notInterested: 3,
			longestStreak: 5
		});
		expect(out[2]).toMatchObject({ deviceId: 'c', saves: 1, currentStreak: 0, lastActiveDay: '' });
	});
});

describe('dailyActivity', () => {
	it('buckets impressions/continuations by UTC day, zero-filled, oldest→newest', () => {
		const now = Date.parse('2026-06-17T12:00:00Z');
		const day = 86_400_000;
		const events = [
			{ type: 'card_impression', ts: now },
			{ type: 'card_impression', ts: now - day },
			{ type: 'card_complete', ts: now },
			{ type: 'card_skip', ts: now }, // not a continuation
			{ type: 'card_impression', ts: now - 30 * day } // outside the window → dropped
		];
		const out = dailyActivity(events, now, 3);
		expect(out).toHaveLength(3);
		expect(out[2]).toEqual({ day: dayKey(now), impressions: 1, continuations: 1 });
		expect(out[1]).toEqual({ day: dayKey(now - day), impressions: 1, continuations: 0 });
		expect(out[0]).toEqual({ day: dayKey(now - 2 * day), impressions: 0, continuations: 0 });
	});
});
