# Topic Catalog Build: Offline ETL

This directory contains `build-catalog.mjs`, an offline ops script that builds
a ranked topic catalog from sampled Wikimedia hourly pageview dumps and emits
a JSONL file ready for Convex import.

## Three-step flow

### 1. Build the catalog

```bash
bun scripts/build-catalog.mjs [--top N] [--out catalog.jsonl] [--files urls.txt]
```

Streams each `.gz` dump file, parses `en` main-namespace article titles,
accumulates view counts, and writes the top-N results as JSONL:

```json
{"title":"Python_(programming_language)","slug":"python_(programming_language)","pageviews":142000}
{"title":"JavaScript","slug":"javascript","pageviews":98500}
```

By default it samples one hour (12:00 UTC on the 1st) per month for the last
~18 months — enough to capture both evergreen articles and seasonal trends
without downloading the entire dump history. Files that return a non-200
response are skipped with a warning.

### 2. Import into staging

```bash
npx convex import --replace --table topicsStaging catalog.jsonl
```

This replaces the `topicsStaging` table wholesale (safe: it is a scratch space).
The `topicsStaging` table holds rows with the same shape as the JSONL
(`title`, `slug`, `pageviews`).

### 3. Merge staging into the catalog

```bash
npx convex run topics:mergeStagingIntoCatalog '{"batch":500}'
```

Run this in a loop until the output contains `"done": true`. Each call
upserts up to 500 topics from staging into the live `topics` catalog:
- New topics are inserted with their pageview count.
- Existing topics have their pageview count merged (summed) and keep their
  existing `cardCount`, `evergreen`, and any other metadata intact.

Shell loop:

```bash
while true; do
  result=$(npx convex run topics:mergeStagingIntoCatalog '{"batch":500}')
  echo "$result"
  echo "$result" | grep -q '"done":true' && break
done
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--top N` | `200000` | Maximum topics to emit (sorted by total pageviews desc) |
| `--out file.jsonl` | `catalog.jsonl` | Output path |
| `--files urls.txt` | (18 built-in URLs) | Newline-separated list of dump URLs to process |

## Widening coverage

To sample more months or specific date ranges, pass a `--files` list:

```bash
# Generate URLs for every 1st of the month in 2025, at 12:00 UTC
for m in 01 02 03 04 05 06 07 08 09 10 11 12; do
  echo "https://dumps.wikimedia.org/other/pageviews/2025/2025-${m}/pageviews-2025${m}01-120000.gz"
done > urls-2025.txt

bun scripts/build-catalog.mjs --files urls-2025.txt --top 500000 --out catalog-2025.jsonl
```

Dump files are listed at: https://dumps.wikimedia.org/other/pageviews/

## Sampling rationale

Each hourly dump file is ~80–150 MB compressed and covers all Wikimedia
projects. Sampling one hour per month across 18 months gives ~18 files
(~2 GB total) while capturing long-term popularity signal. The 12:00 UTC
slot is chosen as a mid-day sample that avoids overnight low-traffic bias.

Titles are filtered through `parsePageviewLine` (which applies the
`isRealArticleTitle` + `isQualityTopic` gates from `convex/topicsLogic.ts`)
to strip namespace pages, list articles, disambiguation pages, and junk titles
before they enter the catalog.
