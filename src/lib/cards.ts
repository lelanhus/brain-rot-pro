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

/** Compact relative time ("just now", "5m", "3h", "2d", "4w") for saved timestamps. */
export function relativeTime(ts: number, now: number = Date.now()): string {
	const s = Math.max(0, Math.round((now - ts) / 1000));
	if (s < 45) return 'just now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h`;
	const d = Math.round(h / 24);
	if (d < 7) return `${d}d`;
	return `${Math.round(d / 7)}w`;
}
