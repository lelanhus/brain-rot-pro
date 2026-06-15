import { describe, expect, it } from 'vitest';
import { advanceStreak, dayDiff, dayKey, type StreakState } from './streakLogic';

describe('dayKey / dayDiff', () => {
	it('keys a timestamp to its UTC calendar day', () => {
		expect(dayKey(Date.parse('2026-06-15T23:59:59Z'))).toBe('2026-06-15');
		expect(dayKey(Date.parse('2026-06-16T00:00:01Z'))).toBe('2026-06-16');
	});
	it('counts whole days between keys, across a month boundary', () => {
		expect(dayDiff('2026-06-15', '2026-06-16')).toBe(1);
		expect(dayDiff('2026-06-30', '2026-07-02')).toBe(2);
		expect(dayDiff('2026-06-16', '2026-06-16')).toBe(0);
	});
});

describe('advanceStreak', () => {
	it('starts a streak on the first ever visit', () => {
		const { state, event } = advanceStreak(null, '2026-06-15');
		expect(event).toBe('started');
		expect(state).toEqual({
			currentStreak: 1,
			longestStreak: 1,
			lastActiveDay: '2026-06-15',
			daysLearned: 1
		});
	});

	const day1: StreakState = {
		currentStreak: 3,
		longestStreak: 5,
		lastActiveDay: '2026-06-15',
		daysLearned: 10
	};

	it('is idempotent within the same day', () => {
		const { state, event } = advanceStreak(day1, '2026-06-15');
		expect(event).toBe('same_day');
		expect(state).toBe(day1); // unchanged reference: no double-count
	});

	it('extends the streak on a consecutive day', () => {
		const { state, event } = advanceStreak(day1, '2026-06-16');
		expect(event).toBe('extended');
		expect(state.currentStreak).toBe(4);
		expect(state.daysLearned).toBe(11);
		expect(state.longestStreak).toBe(5); // still below the record
	});

	it('updates the longest streak once the current passes it', () => {
		const atRecord: StreakState = { ...day1, currentStreak: 5, longestStreak: 5 };
		const { state } = advanceStreak(atRecord, '2026-06-16');
		expect(state.currentStreak).toBe(6);
		expect(state.longestStreak).toBe(6);
	});

	it('resets to 1 after a gap but preserves the record and counts the day', () => {
		const { state, event } = advanceStreak(day1, '2026-06-18'); // missed the 16th–17th
		expect(event).toBe('reset');
		expect(state.currentStreak).toBe(1);
		expect(state.longestStreak).toBe(5);
		expect(state.daysLearned).toBe(11);
	});
});
