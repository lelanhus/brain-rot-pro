'use node';

import { action } from './_generated/server';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { generateObject, embed } from 'ai';
import {
	HOOK_MAX_CHARS,
	PROMPT_VERSION,
	buildGenerationPrompt,
	buildValidationPrompt,
	clampBody,
	decidePublish,
	generatedCardSchema,
	spanIsFromSource,
	validationSchema
} from './generateLogic';
import { buildEmbeddingText, embeddingModel } from './embedLogic';
import { requireGatewayKey } from './aiKey';

// Env-overridable model defaults (Vercel AI Gateway slugs). Set GENERATION_MODEL
// / VALIDATION_MODEL in the Convex env to override. Generator ≠ validator so the
// support check is an independent judgement (review §3.2).
const DEFAULT_GENERATION_MODEL = 'anthropic/claude-sonnet-4.5';
const DEFAULT_VALIDATION_MODEL = 'anthropic/claude-haiku-4.5';

// Cosine-similarity bar above which a new card is treated as a near-duplicate of
// an already-published one and dropped — so an infinite feed never means infinite
// rewordings. Env-overridable to tune; 0.88 blocks rephrasings while allowing
// genuinely distinct facts about the same subject.
function dedupThreshold(): number {
	const raw = Number(process.env.DEDUP_THRESHOLD);
	return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.88;
}

/** Surface an AI SDK failure loudly, including the raw model text when present. */
function wrapAiError(stage: string, e: unknown): Error {
	const err = e as { text?: string; cause?: { message?: string } };
	const detail = err.text ? ` :: ${err.text.slice(0, 400)}` : '';
	return new Error(`${stage} failed: ${err.cause?.message ?? String(e)}${detail}`, { cause: e });
}

/**
 * Generate one card from an ingested article: generator model → candidate,
 * verbatim-span guard, then a DIFFERENT validator model judges support. With no
 * human in the loop, a grounded + high-confidence card AUTO-PUBLISHES (embedded
 * for "more like this" + dedup; near-duplicates of existing cards are dropped);
 * anything below the bar is `validation_failed`. Trust = Wikipedia for the facts,
 * the grounding + validator for faithfulness.
 *   npx convex run generate:generateFromArticle '{"articleId":"<id>"}'
 */
export const generateFromArticle = action({
	args: { articleId: v.id('sourceArticles'), avoidHooks: v.optional(v.array(v.string())) },
	// Explicit return type breaks the self-referential inference cycle (the
	// action reads its own deployment's `internal` api).
	handler: async (
		ctx,
		args
	): Promise<{
		cardId: Id<'knowledgeCards'> | null;
		status: 'published' | 'validation_failed' | 'duplicate';
		grounded: boolean;
		supportScore: number;
		reason: string;
		hook: string;
	}> => {
		requireGatewayKey();

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
				prompt: buildGenerationPrompt(
					{ title: article.title, paragraphs: article.paragraphs },
					args.avoidHooks
				)
			});
			card = generated.object;
		} catch (e) {
			throw wrapAiError('generation', e);
		}

		// Enforce the one-screen body cap by trimming after generation (not by hard-
		// rejecting the model output), so a slightly-long response never crashes the pipeline.
		card.body = clampBody(card.body);

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
		} catch (e) {
			throw wrapAiError('validation', e);
		}
		// Clamp in case the model returns a 0–100 scale instead of 0–1.
		const score = Math.max(
			0,
			Math.min(1, validation.score > 1 ? validation.score / 100 : validation.score)
		);
		// Auto-publish: no human in the loop, so a card publishes ONLY when it's
		// grounded in a real source span AND the validator confirms support at high
		// confidence (decidePublish). Otherwise it's auto-failed.
		const status = decidePublish(grounded, {
			supported: validation.supported,
			score,
			reason: validation.reason
		});

		// For a passing card, embed it (for "more like this" + dedup) and drop it if
		// it's a near-duplicate of something already published — infinite cards, not
		// infinite rewordings.
		let embedding: number[] | undefined;
		if (status === 'published') {
			const { embedding: vec } = await embed({
				model: embeddingModel(),
				value: buildEmbeddingText(card)
			});
			const dup = await ctx.vectorSearch('knowledgeCards', 'by_embedding', {
				vector: vec,
				limit: 1,
				filter: (q) => q.eq('status', 'published')
			});
			const topScore = dup[0]?._score ?? 0;
			if (topScore >= dedupThreshold()) {
				return {
					cardId: null,
					status: 'duplicate' as const,
					grounded,
					supportScore: score,
					reason: `near-duplicate (cosine ${topScore.toFixed(2)})`,
					hook: card.hook
				};
			}
			embedding = vec;
		}

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
			// Carry the article's pre-cleared free-licensed image (if any) onto the card.
			image: article.image ?? undefined,
			embedding,
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
 * One-time: shorten legacy published cards whose body OR hook exceeds its one-screen cap.
 * Lossless: suppresses an oversized card only while regenerating from its source
 * article, and RESTORES it if no valid short replacement publishes (so a failed
 * regeneration never removes a card). Hand-seeded cards (no source article) are
 * left untouched.
 *   npx convex run generate:backfillShortenOverlong '{"limit":50}'
 */
export const backfillShortenOverlong = action({
	args: {
		cap: v.optional(v.number()),
		hookCap: v.optional(v.number()),
		limit: v.optional(v.number())
	},
	handler: async (
		ctx,
		args
	): Promise<{ scanned: number; regenerated: number; keptUnchanged: number; errored: number }> => {
		const cap = args.cap ?? 480;
		const hookCap = args.hookCap ?? HOOK_MAX_CHARS;
		const limit = args.limit ?? 50;
		const rows = await ctx.runQuery(internal.generateDb.overlongPublished, { cap, hookCap, limit });
		let regenerated = 0;
		let keptUnchanged = 0; // left published as-is (no source article, or no valid short replacement)
		let errored = 0; // regeneration threw; original restored
		for (const row of rows) {
			// Hand-seeded cards have no source article to regenerate from — never remove them.
			if (row.articleId === null) {
				keptUnchanged++;
				continue;
			}
			// Suppress first so the fresh card isn't dropped as a near-duplicate of this original.
			await ctx.runMutation(internal.generateDb.setCardStatus, {
				cardId: row._id,
				status: 'suppressed'
			});
			try {
				const r = await ctx.runAction(api.generate.generateFromArticle, {
					articleId: row.articleId
				});
				if (r.status === 'published') {
					regenerated++;
				} else {
					// No valid short replacement (validation_failed / duplicate) → restore the
					// original so no card is lost (it keeps its long hook, but stays in the feed).
					await ctx.runMutation(internal.generateDb.setCardStatus, {
						cardId: row._id,
						status: 'published'
					});
					keptUnchanged++;
				}
			} catch {
				// Regeneration errored → restore the original.
				await ctx.runMutation(internal.generateDb.setCardStatus, {
					cardId: row._id,
					status: 'published'
				});
				errored++;
			}
		}
		return { scanned: rows.length, regenerated, keptUnchanged, errored };
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
		results: { published: number; validation_failed: number; duplicate: number };
	}> => {
		const ids = await ctx.runQuery(internal.generateDb.articlesNeedingCards, {
			limit: args.limit ?? 3
		});
		const results = { published: 0, validation_failed: 0, duplicate: 0 };
		for (const articleId of ids) {
			const r = await ctx.runAction(api.generate.generateFromArticle, { articleId });
			results[r.status] += 1;
		}
		return { attempted: ids.length, results };
	}
});
