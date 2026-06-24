/**
 * Legibility decision for the full-bleed card face (redesign §6). PURE — no
 * network, no decode. The ingest action samples luminance of the top strip and
 * bottom third (where the chrome + caption sit) and asks this which scrim level
 * guarantees white-on-image contrast regardless of the photo.
 */

/** sRGB relative luminance (WCAG), inputs 0–255, output 0–1. */
export function relativeLuminance(r: number, g: number, b: number): number {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Thresholds on the BRIGHTER of the two sampled regions: the worse zone dictates
// the scrim so neither the top chrome nor the bottom caption can wash out.
const MEDIUM_AT = 0.4;
const HEAVY_AT = 0.7;

export type ScrimLevel = 'light' | 'medium' | 'heavy';

export function scrimLevelFor(input: {
	topLuminance: number;
	bottomLuminance: number;
}): ScrimLevel {
	const worst = Math.max(input.topLuminance, input.bottomLuminance);
	if (worst >= HEAVY_AT) return 'heavy';
	if (worst >= MEDIUM_AT) return 'medium';
	return 'light';
}

/** Decoded RGBA pixels (the shape jpeg-js returns with formatAsRGBA). */
export type RGBA = {
	data: Uint8Array | Uint8ClampedArray | ArrayLike<number>;
	width: number;
	height: number;
};

/**
 * Mean relative luminance of the TOP strip (~15%, behind the top-right chrome —
 * the §6 weak point) and the BOTTOM third (~33%, behind the caption + rail).
 * Sub-samples columns so a large thumbnail stays cheap. PURE — feeds scrimLevelFor.
 */
export function sampleLuminance(img: RGBA): { topLuminance: number; bottomLuminance: number } {
	const { data, width, height } = img;
	if (width <= 0 || height <= 0) return { topLuminance: 0.5, bottomLuminance: 0.5 };
	const stepX = Math.max(1, Math.floor(width / 64)); // ~64 columns per row
	const avg = (y0: number, y1: number): number => {
		let sum = 0;
		let n = 0;
		for (let y = y0; y < y1; y++) {
			for (let x = 0; x < width; x += stepX) {
				const i = (y * width + x) * 4;
				sum += relativeLuminance(data[i], data[i + 1], data[i + 2]);
				n += 1;
			}
		}
		return n === 0 ? 0.5 : sum / n;
	};
	const topRows = Math.max(1, Math.round(height * 0.15));
	const bottomStart = Math.min(height - 1, Math.round(height * 0.67));
	return { topLuminance: avg(0, topRows), bottomLuminance: avg(bottomStart, height) };
}
