import { describe, expect, it } from 'vitest';
import { classifyTopic, decideArticleStatus, HUMAN } from './wikidataLogic';

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
