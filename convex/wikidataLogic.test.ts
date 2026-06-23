import { describe, expect, it } from 'vitest';
import {
	classifyTopic,
	decideArticleStatus,
	isEphemeral,
	EPHEMERAL_WINDOW_YEARS,
	HUMAN
} from './wikidataLogic';

describe('classifyTopic', () => {
	it('allows evergreen classes (species, element, language)', () => {
		expect(classifyTopic({ instanceOf: ['Q16521'] }).verdict).toBe('allow'); // taxon
		expect(classifyTopic({ instanceOf: ['Q11344'] }).verdict).toBe('allow'); // chemical element
		expect(classifyTopic({ instanceOf: ['Q34770'] }).verdict).toBe('allow'); // language
	});

	it('blocks ephemeral creative products (film, album, video game)', () => {
		expect(classifyTopic({ instanceOf: ['Q11424'] }).verdict).toBe('block'); // film
		expect(classifyTopic({ instanceOf: ['Q482994'] }).verdict).toBe('block'); // album
		expect(classifyTopic({ instanceOf: ['Q7889'] }).verdict).toBe('block'); // video game
	});

	it('judges people by occupation: scholars allowed, entertainers/athletes blocked', () => {
		expect(classifyTopic({ instanceOf: [HUMAN], occupations: ['Q169470'] }).verdict).toBe('allow'); // physicist
		expect(classifyTopic({ instanceOf: [HUMAN], occupations: ['Q937857'] }).verdict).toBe('block'); // footballer
		expect(classifyTopic({ instanceOf: [HUMAN], occupations: ['Q177220'] }).verdict).toBe('block'); // singer
	});

	it('returns unknown for a person with an unclassified occupation', () => {
		expect(classifyTopic({ instanceOf: [HUMAN], occupations: ['Q99999999'] }).verdict).toBe(
			'unknown'
		);
		expect(classifyTopic({ instanceOf: [HUMAN] }).verdict).toBe('unknown');
	});

	it('lets block win over allow when a topic carries both signals', () => {
		// e.g. a person tagged both physicist and footballer → block (noise wins)
		const v = classifyTopic({ instanceOf: [HUMAN], occupations: ['Q169470', 'Q937857'] });
		expect(v.verdict).toBe('block');
	});

	it('checks subclassOf too, and returns unknown for unrecognized types', () => {
		expect(classifyTopic({ instanceOf: ['Q999'], subclassOf: ['Q11424'] }).verdict).toBe('block');
		expect(classifyTopic({ instanceOf: ['Q123456'] }).verdict).toBe('unknown');
	});
});

describe('decideArticleStatus', () => {
	const allow = { verdict: 'allow' as const, reason: 'x' };
	const block = { verdict: 'block' as const, reason: 'x' };
	const unknown = { verdict: 'unknown' as const, reason: 'x' };

	it('honors an authoritative Wikidata allow/block over the categories', () => {
		// Wikidata allow wins even if categories look like noise.
		expect(decideArticleStatus({ verdict: allow, categories: ['2026 films'] }).status).toBe(
			'fetched'
		);
		// Wikidata block wins even if categories look evergreen.
		expect(decideArticleStatus({ verdict: block, categories: ['Physics'] }).status).toBe(
			'filtered_out'
		);
	});

	it('falls back to the category heuristic when Wikidata is unknown or absent', () => {
		expect(decideArticleStatus({ verdict: unknown, categories: ['Ancient Rome'] }).status).toBe(
			'fetched'
		);
		expect(decideArticleStatus({ verdict: null, categories: ['English footballers'] }).status).toBe(
			'filtered_out'
		);
	});
});

describe('isEphemeral', () => {
	const now = 2026;
	it('flags a temporal anchor inside the window', () => {
		expect(isEphemeral({ temporalYears: [2026], title: 'X' }, now).ephemeral).toBe(true);
		expect(isEphemeral({ temporalYears: [2024], title: 'X' }, now).ephemeral).toBe(true); // window=2
	});
	it('keeps old temporal anchors (WWI, Chernobyl, Dreadnought)', () => {
		expect(isEphemeral({ temporalYears: [1914], title: 'World War I' }, now).ephemeral).toBe(false);
		expect(isEphemeral({ temporalYears: [1986], title: 'Chernobyl disaster' }, now).ephemeral).toBe(
			false
		);
		expect(isEphemeral({ temporalYears: [1906], title: 'Dreadnought' }, now).ephemeral).toBe(false);
	});
	it('flags a recent-year token in the title (no temporal data needed)', () => {
		expect(
			isEphemeral({ temporalYears: [], title: 'List of attacks during the 2026 Iran war' }, now)
				.ephemeral
		).toBe(true);
		expect(isEphemeral({ temporalYears: [], title: '2026 Iran war' }, now).ephemeral).toBe(true);
	});
	it('does not flag evergreen topics with no recent signal', () => {
		expect(isEphemeral({ temporalYears: [], title: 'Wombat' }, now).ephemeral).toBe(false);
		expect(
			isEphemeral({ temporalYears: [], title: 'List of chemical elements' }, now).ephemeral
		).toBe(false);
	});
	it('uses EPHEMERAL_WINDOW_YEARS = 2', () => {
		expect(EPHEMERAL_WINDOW_YEARS).toBe(2);
	});
});

describe('decideArticleStatus recency', () => {
	it('ephemeral beats an allowlist allow', () => {
		const verdict = classifyTopic({ instanceOf: ['Q198'] }); // war → allow
		expect(verdict.verdict).toBe('allow');
		const r = decideArticleStatus({
			verdict,
			categories: [],
			title: '2026 Iran war',
			temporalYears: [2026],
			nowYear: 2026
		});
		expect(r.status).toBe('filtered_out');
		expect(r.basis.startsWith('ephemeral')).toBe(true);
	});
	it('is unchanged when nowYear is omitted (back-compat)', () => {
		const verdict = classifyTopic({ instanceOf: ['Q198'] });
		expect(decideArticleStatus({ verdict, categories: [] }).status).toBe('fetched');
	});
});
