#!/usr/bin/env bun
// Build a ranked topic catalog from sampled Wikimedia hourly pageview dumps.
// Usage: bun scripts/build-catalog.mjs [--top N] [--out file.jsonl] [--files urls.txt]
// Streams each .gz dump, parses en main-namespace articles, accumulates views,
// emits top-N JSONL {title, slug, pageviews}. Then:
//   npx convex import --replace --table topicsStaging <out>
//   (loop) npx convex run topics:mergeStagingIntoCatalog '{"batch":500}'  until {"done":true}
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { parsePageviewLine } from '../convex/dumpParse.js';
import { toSlug } from '../convex/topicsLogic.js';

// Default sample: one hour (12:00) on the 1st of each of the last ~18 months,
// spread across time to dilute recency. Edit/override via --files.
const DEFAULT_FILES = (() => {
	const urls = [];
	for (let i = 1; i <= 18; i++) {
		const d = new Date(Date.UTC(2026, 5 - i, 1, 12)); // walk back from 2026-05
		const y = d.getUTCFullYear();
		const m = String(d.getUTCMonth() + 1).padStart(2, '0');
		const day = String(d.getUTCDate()).padStart(2, '0');
		urls.push(`https://dumps.wikimedia.org/other/pageviews/${y}/${y}-${m}/pageviews-${y}${m}${day}-120000.gz`);
	}
	return urls;
})();

const arg = (flag, def) => {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : def;
};
const TOP = Number(arg('--top', '200000'));
const OUT = arg('--out', 'catalog.jsonl');

async function streamFile(url, counts) {
	const res = await fetch(url, { headers: { 'User-Agent': 'BrainRotPro/0.1 (leland.husband@gmail.com)' } });
	if (!res.ok) { console.error(`skip ${url}: ${res.status}`); return; }
	const rl = createInterface({ input: (await import('node:stream')).Readable.fromWeb(res.body).pipe(createGunzip()) });
	for await (const line of rl) {
		const p = parsePageviewLine(line);
		if (p) counts.set(p.title, (counts.get(p.title) ?? 0) + p.views);
	}
	console.error(`done ${url} (${counts.size} unique so far)`);
}

const files = process.argv.includes('--files')
	? (await import('node:fs')).readFileSync(arg('--files'), 'utf8').split('\n').filter(Boolean)
	: DEFAULT_FILES;
const counts = new Map();
for (const url of files) { try { await streamFile(url, counts); } catch (e) { console.error(`error ${url}: ${e.message}`); } }

const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP);
const jsonl = top.map(([title, pageviews]) => JSON.stringify({ title, slug: toSlug(title), pageviews })).join('\n');
writeFileSync(OUT, jsonl);
console.error(`wrote ${top.length} topics to ${OUT}`);
