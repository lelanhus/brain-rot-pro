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

/** Interaction event types (design doc §11.3). */
export const eventType = v.union(
	v.literal('session_start'),
	v.literal('session_end'),
	v.literal('card_impression'),
	v.literal('card_complete'),
	v.literal('card_skip'),
	v.literal('card_expand'),
	v.literal('related_tap'),
	v.literal('save'),
	v.literal('unsave'),
	v.literal('source_open'),
	v.literal('not_interested')
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
export const sourceValidator = v.object({
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
export const image = v.object({
	thumbnailUrl: v.string(),
	commonsUrl: v.string(),
	author: v.string(),
	licenseShortName: v.string(),
	licenseUrl: v.string(),
	attribution: v.string()
});

/** Generation provenance (design doc §9.3): present on AI-generated cards. */
export const generationValidator = v.object({
	generationModel: v.string(),
	validationModel: v.string(),
	supportScore: v.number(),
	promptVersion: v.string(),
	sourceArticleId: v.id('sourceArticles'),
	generatedAt: v.number()
});

export default defineSchema({
	knowledgeCards: defineTable({
		hook: v.string(),
		body: v.string(),
		whyItMatters: v.optional(v.string()),
		format: cardFormat,
		conceptTags: v.array(v.string()),
		source: sourceValidator,
		image: v.optional(image),
		// Semantic embedding of the card (hook+body+tags), for vector "more like
		// this". Optional: backfilled for seeds, generated on publish. Dimension is
		// locked to the index below — changing the embedding model means a reindex.
		embedding: v.optional(v.array(v.float64())),
		generation: v.optional(generationValidator),
		status: cardStatus,
		// Deterministic-but-varied feed order: a random key assigned once at write
		// time, so the feed query stays deterministic (ADR-007 — no in-query RNG).
		shuffleKey: v.number(),
		createdAt: v.number()
	})
		.index('by_status_shuffle', ['status', 'shuffleKey'])
		.vectorIndex('by_embedding', {
			vectorField: 'embedding',
			dimensions: 1536, // openai/text-embedding-3-small
			filterFields: ['status']
		}),

	/**
	 * Raw interaction events (design doc §11.3). Write-heavy, append-only; the
	 * feed query never reads these (ADR-007 — volatile signals stay out of the
	 * reactive feed read). `deviceId` is the anonymous, pre-auth identity.
	 */
	events: defineTable({
		deviceId: v.string(),
		sessionId: v.string(),
		type: eventType,
		cardId: v.optional(v.id('knowledgeCards')),
		visibleMs: v.optional(v.number()),
		ts: v.number()
	})
		.index('by_device', ['deviceId'])
		.index('by_device_session', ['deviceId', 'sessionId']),

	/**
	 * Ingested Wikipedia source articles (design doc §8.3, ADR-005). Full
	 * provenance is captured here so generated cards can ground claims in exact
	 * paragraphs. Fetched via the MediaWiki Action API behind the adapter in
	 * `ingest.ts` (the durable, non-deprecating surface).
	 */
	sourceArticles: defineTable({
		pageId: v.number(),
		title: v.string(),
		url: v.string(),
		revisionId: v.union(v.number(), v.null()),
		extract: v.string(),
		paragraphs: v.array(v.string()),
		categories: v.array(v.string()),
		// Lead image, only when proven free-licensed (ADR-005, fail-closed). Carried
		// onto generated cards; absent means no clearable image was found.
		image: v.optional(image),
		pageviews: v.optional(v.number()),
		fetchedAt: v.number(),
		status: v.union(v.literal('fetched'), v.literal('filtered_out'))
	}).index('by_pageId', ['pageId']),

	/** Cards a device has saved. Bounded per device. */
	savedCards: defineTable({
		deviceId: v.string(),
		cardId: v.id('knowledgeCards'),
		savedAt: v.number()
	})
		.index('by_device', ['deviceId'])
		.index('by_device_card', ['deviceId', 'cardId']),

	/**
	 * Precomputed personalization profile per device (ADR-007). The feed query
	 * reads THIS (one cheap doc), not the raw events — so logging an event doesn't
	 * invalidate the feed (avoids reactivity amplification). Rebuilt by
	 * `profile.recompute` on session start and after strong signals.
	 */
	userProfiles: defineTable({
		deviceId: v.string(),
		conceptWeights: v.array(v.object({ concept: v.string(), weight: v.number() })),
		seen: v.array(v.id('knowledgeCards')),
		notInterested: v.array(v.id('knowledgeCards')),
		updatedAt: v.number()
	}).index('by_device', ['deviceId']),

	/**
	 * Per-device engagement stats — the daily-return hook (streak) and lifetime
	 * days-learned. Separate from `userProfiles` so the feed query never reads it;
	 * updated once per session by `stats.recordActivity` (idempotent within a day).
	 */
	deviceStats: defineTable({
		deviceId: v.string(),
		currentStreak: v.number(),
		longestStreak: v.number(),
		lastActiveDay: v.string(), // UTC YYYY-MM-DD
		daysLearned: v.number(),
		updatedAt: v.number()
	}).index('by_device', ['deviceId']),

	/**
	 * Short-lived, single-use codes that let another device adopt this device's
	 * anonymous account (ADR-004 — cross-device save without OAuth). The code maps
	 * to the source `deviceId`; redeeming hands that id to the new device.
	 */
	syncCodes: defineTable({
		code: v.string(), // normalized (uppercase, no separators)
		deviceId: v.string(),
		createdAt: v.number(),
		expiresAt: v.number(),
		redeemedAt: v.optional(v.number())
	}).index('by_code', ['code'])
});
