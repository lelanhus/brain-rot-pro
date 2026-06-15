'use node';

import { action } from './_generated/server';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { generateObject } from 'ai';
import {
	PROMPT_VERSION,
	buildGenerationPrompt,
	buildValidationPrompt,
	decideStatus,
	generatedCardSchema,
	spanIsFromSource,
	validationSchema
} from './generateLogic';

// The AI SDK's default gateway provider reads AI_GATEWAY_API_KEY. We accept a
// few common names and normalize, so it works whichever the user set.
const KEY_CANDIDATES = [
	'AI_GATEWAY_API_KEY',
	'VERCEL_AI_GATEWAY_API_KEY',
	'AI_GATEWAY_KEY',
	'VERCEL_AI_GATEWAY_KEY',
	'GATEWAY_API_KEY'
];

// Env-overridable model defaults (Vercel AI Gateway slugs). Set GENERATION_MODEL
// / VALIDATION_MODEL in the Convex env to override. Generator ≠ validator so the
// support check is an independent judgement (review §3.2).
const DEFAULT_GENERATION_MODEL = 'anthropic/claude-sonnet-4.5';
const DEFAULT_VALIDATION_MODEL = 'anthropic/claude-haiku-4.5';

function resolveKey(): { name: string; value: string } | null {
	for (const name of KEY_CANDIDATES) {
		const value = process.env[name];
		if (value) return { name, value };
	}
	return null;
}

/** Diagnostic: report what generation config is present (names/model ids only, no secrets). */
export const config = action({
	args: {},
	handler: async () => {
		const key = resolveKey();
		return {
			hasKey: !!key,
			keyEnvVar: key?.name ?? null,
			generationModel: process.env.GENERATION_MODEL ?? null,
			validationModel: process.env.VALIDATION_MODEL ?? null
		};
	}
});

/**
 * Generate one card from an ingested article: generator model → candidate,
 * verbatim-span guard, then a DIFFERENT validator model judges support
 * (review §3.2). Stores a draft as `needs_review` (manual approve queue) or
 * `validation_failed`. Never publishes directly.
 *   npx convex run generate:generateFromArticle '{"articleId":"<id>"}'
 */
export const generateFromArticle = action({
	args: { articleId: v.id('sourceArticles') },
	// Explicit return type breaks the self-referential inference cycle (the
	// action reads its own deployment's `internal` api).
	handler: async (
		ctx,
		args
	): Promise<{
		cardId: Id<'knowledgeCards'>;
		status: 'needs_review' | 'validation_failed';
		grounded: boolean;
		supportScore: number;
		reason: string;
		hook: string;
	}> => {
		const key = resolveKey();
		if (!key) {
			throw new Error(
				`No AI gateway key found. Set one of ${KEY_CANDIDATES.join(', ')} in the Convex deployment env.`
			);
		}
		// Normalize so the AI SDK's default gateway provider picks it up.
		process.env.AI_GATEWAY_API_KEY = key.value;

		const generationModel = process.env.GENERATION_MODEL ?? DEFAULT_GENERATION_MODEL;
		const validationModel = process.env.VALIDATION_MODEL ?? DEFAULT_VALIDATION_MODEL;

		const article = await ctx.runQuery(internal.generateDb.getArticle, {
			articleId: args.articleId
		});
		if (!article) throw new Error('article not found');
		if (article.paragraphs.length === 0) throw new Error('article has no grounding paragraphs');

		let card;
		try {
			const generated = await generateObject({
				model: generationModel,
				schema: generatedCardSchema,
				prompt: buildGenerationPrompt({ title: article.title, paragraphs: article.paragraphs })
			});
			card = generated.object;
		} catch (e: unknown) {
			const err = e as { text?: string; cause?: { message?: string } };
			throw new Error(
				`generation failed: ${err.cause?.message ?? String(e)}${err.text ? ` :: ${err.text.slice(0, 400)}` : ''}`,
				{ cause: e }
			);
		}

		// Hard guard against invented spans before we even ask the validator.
		const grounded = spanIsFromSource(card.sourceSpan, article.paragraphs);

		let validation;
		try {
			const validated = await generateObject({
				model: validationModel,
				schema: validationSchema,
				prompt: buildValidationPrompt(card)
			});
			validation = validated.object;
		} catch (e: unknown) {
			const err = e as { text?: string; cause?: { message?: string } };
			throw new Error(
				`validation failed: ${err.cause?.message ?? String(e)}${err.text ? ` :: ${err.text.slice(0, 400)}` : ''}`,
				{ cause: e }
			);
		}
		// Clamp in case the model returns a 0–100 scale instead of 0–1.
		const score = Math.max(
			0,
			Math.min(1, validation.score > 1 ? validation.score / 100 : validation.score)
		);
		const status = grounded
			? decideStatus({ supported: validation.supported, score, reason: validation.reason })
			: 'validation_failed';

		const cardId = await ctx.runMutation(internal.generateDb.insertGeneratedCard, {
			hook: card.hook,
			body: card.body,
			whyItMatters: card.whyItMatters,
			format: card.format,
			conceptTags: card.conceptTags,
			source: {
				articleTitle: article.title,
				articleUrl: article.url,
				pageId: article.pageId,
				revisionId: article.revisionId,
				sourceSpan: card.sourceSpan
			},
			status,
			generation: {
				generationModel,
				validationModel,
				supportScore: score,
				promptVersion: PROMPT_VERSION,
				sourceArticleId: args.articleId,
				generatedAt: Date.now()
			}
		});

		return {
			cardId,
			status,
			grounded,
			supportScore: score,
			reason: validation.reason,
			hook: card.hook
		};
	}
});

/**
 * Generate cards for up to `limit` ingested articles that don't have one yet.
 * Sequential to stay polite to the model + within action limits.
 *   npx convex run generate:generateBatch '{"limit":3}'
 */
export const generateBatch = action({
	args: { limit: v.optional(v.number()) },
	handler: async (
		ctx,
		args
	): Promise<{
		attempted: number;
		results: { needs_review: number; validation_failed: number };
	}> => {
		const ids = await ctx.runQuery(internal.generateDb.articlesNeedingCards, {
			limit: args.limit ?? 3
		});
		const results = { needs_review: 0, validation_failed: 0 };
		for (const articleId of ids) {
			const r = await ctx.runAction(api.generate.generateFromArticle, { articleId });
			results[r.status] += 1;
		}
		return { attempted: ids.length, results };
	}
});
