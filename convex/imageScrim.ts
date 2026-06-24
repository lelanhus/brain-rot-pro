'use node';

/**
 * Per-card legibility level from the actual image (redesign §6). Runs in the
 * Node runtime so it can decode the Commons JPEG thumbnail with jpeg-js (pure
 * JS). Samples the top strip + bottom third and asks `scrimLevelFor` which scrim
 * guarantees white-on-image contrast. FAIL-SAFE: any fetch/decode error (e.g. a
 * non-JPEG thumbnail) degrades to 'medium' — never 'light' — and never throws,
 * so it can never block an image from attaching.
 */

import { internalAction } from './_generated/server';
import { v } from 'convex/values';
import jpeg from 'jpeg-js';
import { sampleLuminance, scrimLevelFor, type ScrimLevel } from './legibility';

export const computeScrim = internalAction({
	args: { url: v.string() },
	handler: async (_ctx, { url }): Promise<ScrimLevel> => {
		try {
			const res = await fetch(url);
			if (!res.ok) return 'medium';
			const bytes = new Uint8Array(await res.arrayBuffer());
			const { data, width, height } = jpeg.decode(bytes, {
				useTArray: true,
				formatAsRGBA: true,
				maxResolutionInMP: 50
			});
			return scrimLevelFor(sampleLuminance({ data, width, height }));
		} catch {
			return 'medium';
		}
	}
});
