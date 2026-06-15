import type { Doc } from '$convex/_generated/dataModel';

/** Card format union, derived from the Convex schema so there's one source of truth. */
export type CardFormat = Doc<'knowledgeCards'>['format'];

const LABELS: Record<CardFormat, string> = {
	surprise_fact: 'Surprise',
	myth_buster: 'Myth-buster',
	hidden_connection: 'Hidden connection',
	mini_biography: 'Mini bio',
	origin_story: 'Origin',
	timeline_shock: 'Timeline',
	cause_effect: 'Cause & effect',
	object_story: 'Object'
};

/** Human-readable label for a card format. Falls back to "Fact" for unknown values. */
export function formatName(format: string): string {
	return LABELS[format as CardFormat] ?? 'Fact';
}
