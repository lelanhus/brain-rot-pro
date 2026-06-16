/**
 * Wikidata topic gate (design doc §8.2 — the positive allowlist that supersedes
 * the category-keyword heuristic). Pure, no network: it classifies an article by
 * its Wikidata `instance of` (P31) / `subclass of` (P279) and, for people, their
 * `occupation` (P106). No QID lookup is required at runtime — the curated sets
 * below are the policy.
 *
 * Design: an *authoritative* allow/block on known types, and `unknown` for
 * everything else so the caller can fall back to the heuristic. This is far more
 * robust than matching English category strings (which miss translations,
 * rename, and conflate "2026 films" with "Films about history").
 *
 * The QID sets are data, deliberately conservative and easy to extend; broaden
 * them against live Wikidata as the funnel is tuned. A wrong/missing QID only
 * costs a fall-through to the heuristic — never a silent bad publish.
 */

import { isEvergreenArticle } from './ingestUtils';

/** `instance of` (P31). */
export const HUMAN = 'Q5';

/** Evergreen, educational entity classes (P31/P279) — allow on sight. */
export const ALLOW_CLASSES = new Set<string>([
	'Q16521', // taxon (species)
	'Q11344', // chemical element
	'Q11173', // chemical compound
	'Q12136', // disease
	'Q34770', // language
	'Q8502', // mountain
	'Q4022', // river
	'Q23397', // lake
	'Q198', // war
	'Q178561', // battle
	'Q11862829', // academic discipline
	'Q3305213', // painting
	'Q6256', // country
	'Q515', // city
	'Q23442', // island
	'Q1497364' // writing system? (kept narrow; extend as needed)
]);

/** Ephemeral / low-density creative products — block on sight. */
export const BLOCK_CLASSES = new Set<string>([
	'Q11424', // film
	'Q24856', // film series
	'Q5398426', // television series
	'Q482994', // album
	'Q134556', // single (music)
	'Q7366', // song
	'Q7889', // video game
	'Q202866' // animated film
]);

/** Occupations that make a *person* article evergreen (scholars, creators of record). */
export const ALLOW_OCCUPATIONS = new Set<string>([
	'Q901', // scientist
	'Q169470', // physicist
	'Q170790', // mathematician
	'Q4964182', // philosopher
	'Q201788', // historian
	'Q11063', // astronomer
	'Q593644', // chemist
	'Q864503', // biologist
	'Q36180', // writer
	'Q1028181', // painter
	'Q11569986', // inventor (kept; extend cautiously)
	'Q82955' // politician (historical figures of record)
]);

/** Occupations that mark a person as entertainment/sports noise — block. */
export const BLOCK_OCCUPATIONS = new Set<string>([
	'Q937857', // association football player
	'Q3665646', // basketball player
	'Q33999', // actor
	'Q10800557', // film actor
	'Q177220', // singer
	'Q639669', // musician
	'Q488205', // singer-songwriter
	'Q2066131', // athlete / sportsperson
	'Q2526255', // film director
	'Q183945' // record producer
]);

/** The Wikidata claims we read for a topic decision. */
export type TopicClaims = {
	instanceOf: string[];
	subclassOf?: string[];
	occupations?: string[];
};

export type TopicVerdict = { verdict: 'allow' | 'block' | 'unknown'; reason: string };

const hits = (ids: string[], set: Set<string>) => ids.filter((id) => set.has(id));

/**
 * Classify a topic from its Wikidata claims. Block wins over allow (so a film
 * directed by a scientist is still a film). People are judged by occupation;
 * anything we don't recognize is `unknown` for the caller to fall back on.
 */
export function classifyTopic(claims: TopicClaims): TopicVerdict {
	const classes = [...claims.instanceOf, ...(claims.subclassOf ?? [])];
	const occupations = claims.occupations ?? [];

	const blockedClass = hits(classes, BLOCK_CLASSES);
	if (blockedClass.length > 0) return { verdict: 'block', reason: `class ${blockedClass[0]}` };

	if (claims.instanceOf.includes(HUMAN)) {
		const blockedOcc = hits(occupations, BLOCK_OCCUPATIONS);
		if (blockedOcc.length > 0) return { verdict: 'block', reason: `occupation ${blockedOcc[0]}` };
		const allowedOcc = hits(occupations, ALLOW_OCCUPATIONS);
		if (allowedOcc.length > 0) return { verdict: 'allow', reason: `occupation ${allowedOcc[0]}` };
		return { verdict: 'unknown', reason: 'human, occupation not classified' };
	}

	const allowedClass = hits(classes, ALLOW_CLASSES);
	if (allowedClass.length > 0) return { verdict: 'allow', reason: `class ${allowedClass[0]}` };

	return { verdict: 'unknown', reason: 'no classified type' };
}

export type ArticleStatus = 'fetched' | 'filtered_out';

/**
 * Final ingest decision: the Wikidata verdict is authoritative when it's allow
 * or block; otherwise (unknown, or no Wikidata entity at all) fall back to the
 * category heuristic. So the allowlist *leads* and the heuristic catches the
 * long tail — strictly better than the heuristic alone.
 */
export function decideArticleStatus(args: { verdict: TopicVerdict | null; categories: string[] }): {
	status: ArticleStatus;
	basis: string;
} {
	const v = args.verdict;
	if (v?.verdict === 'allow') return { status: 'fetched', basis: `wikidata: ${v.reason}` };
	if (v?.verdict === 'block') return { status: 'filtered_out', basis: `wikidata: ${v.reason}` };
	const evergreen = isEvergreenArticle(args.categories);
	return {
		status: evergreen ? 'fetched' : 'filtered_out',
		basis: `heuristic: ${evergreen ? 'evergreen' : 'excluded'}`
	};
}
