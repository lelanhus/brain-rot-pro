/**
 * Image-coverage candidate selection (ADR-005). Pure logic, no network — the
 * ingest action fetches license metadata for each candidate in turn and keeps the
 * first that clears the fail-closed gate (`selectFreeImage`). This just decides
 * WHAT to try, and in what order:
 *
 *   1. the article's lead image (`pageimage`)
 *   2. the Wikidata entity image (P18) — usually the canonical free photo
 *   3. other images on the article page
 *
 * Non-content files (wiki chrome: logos, icons, flags, coats of arms, maps,
 * SVGs) are filtered out so a card never ships a Commons logo as its "picture".
 * De-duped and capped so ingest makes a bounded number of license checks.
 */

// Chrome / iconography, not subject photos. Matched on the bare File name.
const NON_CONTENT =
	/(\.svg$)|logo|icon|flag|coat[ _]of[ _]arms|\bseal\b|\bmap\b|\bsymbol\b|wiktionary|commons-logo|ambox|question[ _]book|edit[ _-]?icon|wikidata|wikimedia|oojs|\bstub\b|disambig|padlock|location[ _]map|blank|placeholder/i;

/** Drop a leading `File:`/`Image:` namespace and surrounding whitespace. */
function stripFilePrefix(name: string): string {
	return name.replace(/^(file|image):/i, '').trim();
}

/** Commons treats spaces and underscores as equivalent — normalize for de-dup. */
function normKey(name: string): string {
	return name.replace(/_/g, ' ').trim().toLowerCase();
}

export function isContentImage(name: string): boolean {
	const bare = stripFilePrefix(name);
	return bare.length > 0 && !NON_CONTENT.test(bare);
}

export function imageCandidates(
	input: { leadImage?: string; wikidataImage?: string; pageImages?: readonly string[] },
	max = 5
): string[] {
	const ordered = [input.leadImage, input.wikidataImage, ...(input.pageImages ?? [])]
		.map((n) => (n ? stripFilePrefix(n) : ''))
		.filter(isContentImage);

	const seen = new Set<string>();
	const out: string[] = [];
	for (const name of ordered) {
		const key = normKey(name);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(name);
		if (out.length >= max) break;
	}
	return out;
}
