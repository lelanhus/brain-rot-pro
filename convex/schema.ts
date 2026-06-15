import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Card format taxonomy (design doc §10.2). Stored as a literal union so a bad
 * value is rejected at write time (fail-fast — engineering-standards §1.1).
 */
export const cardFormat = v.union(
	v.literal('surprise_fact'),
	v.literal('myth_buster'),
	v.literal('hidden_connection'),
	v.literal('mini_biography'),
	v.literal('origin_story'),
	v.literal('timeline_shock'),
	v.literal('cause_effect'),
	v.literal('object_story')
);

/** Card lifecycle (design doc §9.4). Only `published` is eligible for the feed. */
export const cardStatus = v.union(
	v.literal('draft'),
	v.literal('needs_review'),
	v.literal('validation_failed'),
	v.literal('approved'),
	v.literal('published'),
	v.literal('suppressed')
);

/**
 * Provenance — every card MUST trace back to its source (ADR-005 / design doc §3.3).
 * `revisionId` is nullable only for hand-seeded Phase-0 cards; the generation
 * pipeline (Phase 2) must populate it. `sourceSpan` is the exact passage the
 * claim is grounded in, required for the source-support validator (review §3.2).
 */
const source = v.object({
	articleTitle: v.string(),
	articleUrl: v.string(),
	pageId: v.optional(v.number()),
	revisionId: v.union(v.number(), v.null()),
	sourceSpan: v.string()
});

/**
 * Image — optional. When present it MUST be a free-licensed Commons asset with
 * full attribution (ADR-005, fail-closed). Omitted entirely for hand-seeded
 * Phase-0 cards rather than shipping unverified license data.
 */
const image = v.object({
	thumbnailUrl: v.string(),
	commonsUrl: v.string(),
	author: v.string(),
	licenseShortName: v.string(),
	licenseUrl: v.string(),
	attribution: v.string()
});

export default defineSchema({
	knowledgeCards: defineTable({
		hook: v.string(),
		body: v.string(),
		whyItMatters: v.optional(v.string()),
		format: cardFormat,
		conceptTags: v.array(v.string()),
		source,
		image: v.optional(image),
		status: cardStatus,
		// Deterministic-but-varied feed order: a random key assigned once at write
		// time, so the feed query stays deterministic (ADR-007 — no in-query RNG).
		shuffleKey: v.number(),
		createdAt: v.number()
	}).index('by_status_shuffle', ['status', 'shuffleKey'])
});
