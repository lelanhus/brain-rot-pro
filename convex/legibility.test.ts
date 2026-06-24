import { describe, it, expect } from 'vitest';
import { scrimLevelFor, relativeLuminance, sampleLuminance } from './legibility';

/** Build an RGBA buffer that is `top` color over the top half, `bottom` over the rest. */
function splitImage(
	width: number,
	height: number,
	top: [number, number, number],
	bottom: [number, number, number]
) {
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const c = y < height / 2 ? top : bottom;
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			data[i] = c[0];
			data[i + 1] = c[1];
			data[i + 2] = c[2];
			data[i + 3] = 255;
		}
	}
	return { data, width, height };
}

describe('scrimLevelFor', () => {
	it('a dark image needs only the light scrim', () => {
		expect(scrimLevelFor({ topLuminance: 0.1, bottomLuminance: 0.15 })).toBe('light');
	});
	it('a mid image bumps to medium', () => {
		expect(scrimLevelFor({ topLuminance: 0.5, bottomLuminance: 0.55 })).toBe('medium');
	});
	it('a bright image needs the heavy (frosted) scrim', () => {
		expect(scrimLevelFor({ topLuminance: 0.9, bottomLuminance: 0.85 })).toBe('heavy');
	});
	it('takes the BRIGHTER of the two regions (the top chrome is the weak point)', () => {
		// Dark caption zone but a blown-out top strip must NOT read as light.
		expect(scrimLevelFor({ topLuminance: 0.92, bottomLuminance: 0.1 })).toBe('heavy');
	});
});

describe('relativeLuminance', () => {
	it('is 0 for black and ~1 for white', () => {
		expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 5);
		expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 2);
	});
	it('ranks a mid-grey between black and white', () => {
		const grey = relativeLuminance(128, 128, 128);
		expect(grey).toBeGreaterThan(0.1);
		expect(grey).toBeLessThan(0.5);
	});
});

describe('sampleLuminance', () => {
	it('reads the top strip and bottom third independently', () => {
		// White top, black bottom: top region bright, bottom region dark.
		const img = splitImage(40, 40, [255, 255, 255], [0, 0, 0]);
		const { topLuminance, bottomLuminance } = sampleLuminance(img);
		expect(topLuminance).toBeGreaterThan(0.9);
		expect(bottomLuminance).toBeLessThan(0.1);
	});

	it('feeds scrimLevelFor — a blown-out top strip forces the heavy scrim', () => {
		const img = splitImage(40, 40, [255, 255, 255], [0, 0, 0]);
		expect(scrimLevelFor(sampleLuminance(img))).toBe('heavy');
	});

	it('a fully dark image stays light', () => {
		const img = splitImage(40, 40, [10, 10, 10], [10, 10, 10]);
		expect(scrimLevelFor(sampleLuminance(img))).toBe('light');
	});
});
