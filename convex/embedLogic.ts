/**
 * Pure helpers for semantic adjacency ("more like this"). No network, no Convex,
 * so they're unit-testable: the text we embed, cosine similarity, and the
 * concept-overlap fallback used when a card has no embedding yet.
 */

/** The embedding model slug (Vercel AI Gateway), env-overridable. Single source
 * of truth shared by the generation pipeline and the embed/backfill actions. */
const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
export function embeddingModel(): string {
	return process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
}

/** What we feed the embedding model: the card's meaning, not its formatting. */
export function buildEmbeddingText(card: {
	hook: string;
	body: string;
	whyItMatters?: string;
	conceptTags: string[];
}): string {
	return [card.hook, card.body, card.whyItMatters ?? '', card.conceptTags.join(', ')]
		.map((s) => s.trim())
		.filter(Boolean)
		.join('\n');
}

/** Cosine similarity of two equal-length vectors. 0 for a degenerate (zero) vector. */
export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) throw new Error(`vector length mismatch: ${a.length} vs ${b.length}`);
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	if (na === 0 || nb === 0) return 0;
	return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

type Tagged = { _id: string; conceptTags: string[] };

/**
 * Fallback ranking when the target has no embedding: order candidates by how
 * many concept tags they share with the target (descending), dropping the
 * target itself and any with zero overlap. Stable for equal scores.
 */
export function relatedByConcepts<T extends Tagged>(
	target: Tagged,
	candidates: T[],
	limit: number
): T[] {
	const targetTags = new Set(target.conceptTags);
	return candidates
		.filter((c) => c._id !== target._id)
		.map((c) => ({ card: c, overlap: c.conceptTags.filter((t) => targetTags.has(t)).length }))
		.filter((x) => x.overlap > 0)
		.sort((a, b) => b.overlap - a.overlap)
		.slice(0, limit)
		.map((x) => x.card);
}
