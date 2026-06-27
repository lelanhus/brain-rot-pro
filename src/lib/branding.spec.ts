import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every user-facing file must carry the Wonderwell brand and no "Brain Rot"
// string. Internal files (package.json, brp_ storage keys, design docs kept
// as historical record) are intentionally excluded.
const BRANDED_FILES = [
	'src/app.html',
	'static/manifest.webmanifest',
	'src/service-worker.ts',
	'src/lib/share.ts',
	'src/routes/+page.svelte',
	'src/routes/c/[id]/+page.svelte',
	'static/icon.svg',
	'static/favicon.svg'
];

describe('Wonderwell branding', () => {
	for (const file of BRANDED_FILES) {
		it(`${file} uses the Wonderwell name, not Brain Rot`, () => {
			const content = readFileSync(file, 'utf8');
			expect(content).toContain('Wonderwell');
			expect(content.toLowerCase()).not.toContain('brain rot');
		});
	}
});
