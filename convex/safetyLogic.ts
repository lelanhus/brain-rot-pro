export type SafetyReason =
	| 'harm'
	| 'active-politics'
	| 'ongoing-legal'
	| 'recent-tragedy'
	| 'medical-advice';

// Always blocked, any era (category/title substrings, lowercased). Tunable.
export const HARM_TERMS = [
	'suicide',
	'self-harm',
	'self harm',
	'pornograph',
	'sexual abuse',
	'child sexual',
	'terroris',
	'extremist',
	'extremism',
	'neo-nazi',
	'white supremac',
	'hate group'
];

// Advice-framed health — blocked any era. NOT bare descriptive drug/supplement
// categories: those are evergreen science (caffeine, aspirin, vitamins stay).
// Only treatment/dosage/self-care framing is blocked. Tunable.
export const MEDICAL_ADVICE_TERMS = [
	'self-medication',
	'drug overdose',
	'home remedies',
	'medical treatment',
	'drugs used to treat'
];

// Blocked only when the SAME category/title is *current* (recent year or marker).
export const POLITICS_TERMS = [
	'election',
	'electoral',
	'impeachment',
	'political scandal',
	'political controvers',
	'referendum',
	'civil unrest'
];
export const LEGAL_TERMS = ['litigation', 'lawsuit', 'court case', 'trial of', 'indictment'];
export const TRAGEDY_TERMS = [
	'disaster',
	'earthquake',
	'mass shooting',
	'massacre',
	'terrorist attack',
	'plane crash',
	'deaths in',
	'disease outbreak',
	'pandemic',
	'famine',
	'wildfire'
];

const ONGOING = /\bongoing\b|\bcurrent\b|\bincumbent\b|\bactive\b/;

function some(hay: string, terms: string[]): boolean {
	return terms.some((t) => hay.includes(t));
}

/** True when `s` reads as a *current* topic: an ongoing marker or a year >= nowYear-1. */
function isCurrent(s: string, nowYear: number | undefined): boolean {
	if (ONGOING.test(s)) return true;
	if (nowYear === undefined) return false;
	const years = s.match(/\b(20\d\d)\b/g);
	return years !== null && years.some((y) => Number(y) >= nowYear - 1);
}

/**
 * Targeted safety classification (W4). Harm + advice-framed health are blocked
 * regardless of era; politics / legal / tragedy are blocked only when current,
 * so historical science/politics/medicine stay. When uncertain → safe.
 */
export function classifySafety(args: { categories: string[]; title: string; nowYear?: number }): {
	safe: boolean;
	reason?: SafetyReason;
} {
	const fields = [...args.categories, args.title].map((s) => s.toLowerCase());
	const hay = fields.join(' || ');

	if (some(hay, HARM_TERMS)) return { safe: false, reason: 'harm' };
	if (some(hay, MEDICAL_ADVICE_TERMS)) return { safe: false, reason: 'medical-advice' };

	for (const field of fields) {
		if (!isCurrent(field, args.nowYear)) continue;
		if (some(field, POLITICS_TERMS)) return { safe: false, reason: 'active-politics' };
		if (some(field, LEGAL_TERMS)) return { safe: false, reason: 'ongoing-legal' };
		if (some(field, TRAGEDY_TERMS)) return { safe: false, reason: 'recent-tragedy' };
	}
	return { safe: true };
}
