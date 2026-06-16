/**
 * Weave "more like this" results into the feed. When a card is dived into, its
 * related cards are inserted immediately after it — the rabbit hole — while
 * preserving the base order and never duplicating a card (first position wins,
 * so a related card already queued later simply moves up).
 */
export function weaveFeed<T extends { _id: string }>(
	base: readonly T[],
	injectedAfter: ReadonlyMap<string, readonly T[]>
): T[] {
	const out: T[] = [];
	const seen = new Set<string>();
	const push = (card: T) => {
		if (seen.has(card._id)) return;
		seen.add(card._id);
		out.push(card);
	};
	for (const card of base) {
		push(card);
		for (const related of injectedAfter.get(card._id) ?? []) push(related);
	}
	return out;
}
