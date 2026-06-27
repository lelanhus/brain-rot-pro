import { describe, expect, it } from 'vitest';
import { classifySafety } from './safetyLogic';

const NOW = 2026;

describe('classifySafety — keeps evergreen', () => {
	it('keeps anatomy / biology', () => {
		expect(
			classifySafety({ categories: ['Human anatomy', 'Organs'], title: 'Heart', nowYear: NOW }).safe
		).toBe(true);
	});
	it('keeps a historical war', () => {
		expect(
			classifySafety({
				categories: ['World War II', 'Battles of 1944'],
				title: 'Battle of Normandy',
				nowYear: NOW
			}).safe
		).toBe(true);
	});
	it('keeps historical politics (1860 election)', () => {
		expect(
			classifySafety({
				categories: ['United States presidential elections', '1860 elections'],
				title: '1860 United States presidential election',
				nowYear: NOW
			}).safe
		).toBe(true);
	});
});

describe('classifySafety — blocks harm (any era)', () => {
	it('blocks suicide', () => {
		const r = classifySafety({ categories: ['Suicide'], title: 'Suicide methods', nowYear: NOW });
		expect(r.safe).toBe(false);
		expect(r.reason).toBe('harm');
	});
	it('blocks even without nowYear', () => {
		expect(classifySafety({ categories: ['Terrorism'], title: 'Terrorist tactics' }).safe).toBe(
			false
		);
	});
});

describe('classifySafety — blocks current, keeps old', () => {
	it('blocks a current election', () => {
		const r = classifySafety({
			categories: ['2026 United States elections'],
			title: '2026 United States Senate elections',
			nowYear: NOW
		});
		expect(r.safe).toBe(false);
		expect(r.reason).toBe('active-politics');
	});
	it('blocks a recent tragedy', () => {
		const r = classifySafety({
			categories: ['Deaths in 2026', 'Disasters in 2026'],
			title: '2026 earthquake',
			nowYear: NOW
		});
		expect(r.safe).toBe(false);
		expect(r.reason).toBe('recent-tragedy');
	});
	it('keeps an old disaster', () => {
		expect(
			classifySafety({
				categories: ['1906 disasters', 'Earthquakes in 1906'],
				title: '1906 San Francisco earthquake',
				nowYear: NOW
			}).safe
		).toBe(true);
	});
});

describe('classifySafety — blocks advice-framed health', () => {
	it('blocks a medication', () => {
		const r = classifySafety({
			categories: ['Antidepressants', 'Medications'],
			title: 'Sertraline',
			nowYear: NOW
		});
		expect(r.safe).toBe(false);
		expect(r.reason).toBe('medical-advice');
	});
});

describe('classifySafety — degenerate input', () => {
	it('empty input is safe', () => {
		expect(classifySafety({ categories: [], title: '' }).safe).toBe(true);
	});
});
