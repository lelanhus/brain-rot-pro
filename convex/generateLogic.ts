import { z } from 'zod';
import type { Infer } from 'convex/values';
import type { cardFormat } from './schema';

/**
 * Pure generation logic (prompt construction, output schemas, the
 * source-support decision). Separated from the network/LLM action so it's
 * unit-testable without a model call. This is the heart of the review's #1
 * trust risk (§3.2): every card must be grounded in an exact source span and
 * pass a cross-model support check before it can be reviewed.
 */

export const PROMPT_VERSION = 'gen-v1';

// `satisfies` makes this fail to compile if a value drifts from the schema's
// cardFormat union — one guarded source for the format list.
export const CARD_FORMATS = [
	'surprise_fact',
	'myth_buster',
	'hidden_connection',
	'mini_biography',
	'origin_story',
	'timeline_shock',
	'cause_effect',
	'object_story'
] as const satisfies readonly Infer<typeof cardFormat>[];

/** Structured card the generator must return. `sourceSpan` MUST be copied verbatim from one input paragraph. */
export const generatedCardSchema = z.object({
	hook: z
		.string()
		.min(8)
		.max(180)
		.describe('One scroll-stopping sentence; declarative, not clickbait.'),
	body: z
		.string()
		.min(80)
		.max(1400)
		.describe('Roughly 40–120 words explaining the one idea, in plain language.'),
	whyItMatters: z
		.string()
		.max(360)
		.describe('One sentence on why it is interesting or significant.'),
	format: z.enum(CARD_FORMATS),
	conceptTags: z.array(z.string()).min(1).max(8),
	sourceSpan: z
		.string()
		.min(20)
		.describe(
			'The exact sentence/paragraph from the provided source text that supports the claim, copied verbatim.'
		)
});
export type GeneratedCard = z.infer<typeof generatedCardSchema>;

/** Validator (a different model) judges whether the card is supported by the source. */
export const validationSchema = z.object({
	supported: z.boolean(),
	score: z
		.number()
		.describe('Confidence 0–1 that the claim is fully supported by the source text.'),
	reason: z.string()
});
export type Validation = z.infer<typeof validationSchema>;

export function buildGenerationPrompt(article: { title: string; paragraphs: string[] }): string {
	const numbered = article.paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n\n');
	return [
		`You are creating ONE short, surprising, source-backed knowledge card from the Wikipedia article "${article.title}".`,
		'',
		'Rules:',
		'- Teach exactly ONE idea, not a summary of the article.',
		'- The claim MUST be fully supported by the source paragraphs below. Do not add facts that are not present.',
		'- Choose the single paragraph that best supports your card and copy it VERBATIM into `sourceSpan`.',
		'- The hook must be specific and true — never sensationalized or misleading.',
		`- Set \`format\` to exactly one of: ${CARD_FORMATS.join(', ')}.`,
		'',
		'Source paragraphs:',
		numbered
	].join('\n');
}

export function buildValidationPrompt(card: GeneratedCard): string {
	return [
		'You are a fact-checker. Decide whether the CARD is fully supported by its SOURCE SPAN.',
		'Be strict: if the hook or body asserts anything not entailed by the source span, it is NOT supported.',
		'',
		`HOOK: ${card.hook}`,
		`BODY: ${card.body}`,
		`SOURCE SPAN: ${card.sourceSpan}`,
		'',
		'Return whether it is supported, a 0–1 confidence score, and a one-line reason.'
	].join('\n');
}

/** Minimum support score to enter the review queue; below this is auto-failed. */
export const SUPPORT_THRESHOLD = 0.7;

export function decideStatus(validation: Validation): 'needs_review' | 'validation_failed' {
	return validation.supported && validation.score >= SUPPORT_THRESHOLD
		? 'needs_review'
		: 'validation_failed';
}

/** Guard: the model must copy a real span from the source, not invent one. */
export function spanIsFromSource(span: string, paragraphs: string[]): boolean {
	const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
	const n = norm(span);
	if (n.length < 20) return false;
	return paragraphs.some((p) => {
		const np = norm(p);
		return np.includes(n) || n.includes(np);
	});
}
