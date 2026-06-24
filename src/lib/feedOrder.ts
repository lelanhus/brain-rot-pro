/**
 * Append-only stable feed order.
 *
 * The live paginated feed re-keys whenever a ranking input changes — taste
 * recompute, focus concept, or connected-wander threading — and (with no
 * `keepPreviousData`) fully RESETS to its first page of `initialNumItems`. Left
 * unmanaged, re-ranking the cards already under the reader yanks a fresh card
 * into the viewport; that card then dwell-completes, which triggers another
 * re-rank: a self-sustaining loop that scrolls the feed on its own.
 *
 * `mergeStableOrder` freezes the order of cards already shown and appends only
 * genuinely new ids (in incoming rank order), so a passive re-rank changes where
 * the NEXT cards land — never where the reader already is. Because it never
 * drops ids, a transient empty/collapsed page (the live query momentarily
 * resetting) does not wipe what is on screen.
 *
 * `reset` adopts the incoming order wholesale — for explicit re-ranks (a focus
 * concept jump, where floating matches to the top IS the intent) and for the
 * first live page replacing the SSR first-paint.
 */
export function mergeStableOrder(
	prevIds: readonly string[],
	incomingIds: readonly string[],
	reset = false
): string[] {
	if (reset) return dedupe(incomingIds);
	const seen = new Set<string>(prevIds);
	const out = [...prevIds];
	for (const id of incomingIds) {
		if (seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

function dedupe(ids: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const id of ids) {
		if (seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}
