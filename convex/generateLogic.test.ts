import { describe, expect, it } from 'vitest';
import {
	BODY_MAX_CHARS,
	buildGenerationPrompt,
	clampBody,
	decidePublish,
	generatedCardSchema,
	publishedDelta,
	spanIsFromSource,
	fillBudget,
	shouldKeepFilling
} from './generateLogic';

describe('buildGenerationPrompt', () => {
	it('numbers and includes the source paragraphs and title', () => {
		const prompt = buildGenerationPrompt({
			title: 'Roman concrete',
			paragraphs: ['First grounding paragraph.', 'Second grounding paragraph.']
		});
		expect(prompt).toContain('Roman concrete');
		expect(prompt).toContain('[1] First grounding paragraph.');
		expect(prompt).toContain('[2] Second grounding paragraph.');
		expect(prompt).toMatch(/verbatim/i);
	});

	it('omits the avoid-hooks line when avoidHooks is absent or empty', () => {
		const base = buildGenerationPrompt({
			title: 'Roman concrete',
			paragraphs: ['Para one.']
		});
		expect(base).not.toContain('DISTINCT');

		const withEmpty = buildGenerationPrompt(
			{ title: 'Roman concrete', paragraphs: ['Para one.'] },
			[]
		);
		expect(withEmpty).not.toContain('DISTINCT');
	});

	it('includes already-covered hooks in the avoid-hooks line', () => {
		const prompt = buildGenerationPrompt({ title: 'Roman concrete', paragraphs: ['Para one.'] }, [
			'Romans used volcanic ash',
			'It hardened underwater'
		]);
		expect(prompt).toContain('DISTINCT');
		expect(prompt).toContain('Romans used volcanic ash');
		expect(prompt).toContain('It hardened underwater');
	});
});

describe('decidePublish (auto-publish gate, default threshold 0.9)', () => {
	it('publishes a grounded, supported, high-confidence card', () => {
		expect(decidePublish(true, { supported: true, score: 0.95, reason: '' })).toBe('published');
		expect(decidePublish(true, { supported: true, score: 0.9, reason: '' })).toBe('published');
	});
	it('fails an ungrounded card even at score 1.0', () => {
		expect(decidePublish(false, { supported: true, score: 1, reason: '' })).toBe(
			'validation_failed'
		);
	});
	it('fails when the validator says unsupported', () => {
		expect(decidePublish(true, { supported: false, score: 0.99, reason: '' })).toBe(
			'validation_failed'
		);
	});
	it('fails just below the auto-publish bar (stricter than the old review bar)', () => {
		expect(decidePublish(true, { supported: true, score: 0.89, reason: '' })).toBe(
			'validation_failed'
		);
		// A card that would have entered the human queue (>=0.7) no longer auto-publishes.
		expect(decidePublish(true, { supported: true, score: 0.8, reason: '' })).toBe(
			'validation_failed'
		);
	});
});

describe('spanIsFromSource', () => {
	const paragraphs = ['Roman concrete could set underwater because of volcanic ash.'];
	it('accepts a verbatim span', () => {
		expect(
			spanIsFromSource('Roman concrete could set underwater because of volcanic ash.', paragraphs)
		).toBe(true);
	});
	it('rejects an invented span', () => {
		expect(spanIsFromSource('Roman concrete was invented by aliens in 1920.', paragraphs)).toBe(
			false
		);
	});
	it('rejects too-short spans', () => {
		expect(spanIsFromSource('short', paragraphs)).toBe(false);
	});
});

describe('generatedCardSchema', () => {
	it('accepts a well-formed card', () => {
		const card = {
			hook: 'Roman concrete could set underwater.',
			body: 'a'.repeat(200),
			whyItMatters: 'It informs modern materials science.',
			format: 'object_story',
			conceptTags: ['Roman concrete'],
			sourceSpan: 'Roman concrete could set underwater because of volcanic ash.'
		};
		expect(generatedCardSchema.safeParse(card).success).toBe(true);
	});
	it('rejects a bad format', () => {
		const bad = {
			hook: 'x'.repeat(10),
			body: 'a'.repeat(200),
			whyItMatters: 'y',
			format: 'not_a_format',
			conceptTags: ['t'],
			sourceSpan: 'a'.repeat(30)
		};
		expect(generatedCardSchema.safeParse(bad).success).toBe(false);
	});

	it('accepts a body slightly over the old cap (481 chars) — schema max is now 2000', () => {
		const card = {
			hook: 'A valid declarative hook.',
			body: 'a'.repeat(481),
			whyItMatters: 'It matters.',
			format: 'object_story',
			conceptTags: ['t'],
			sourceSpan: 'a'.repeat(30)
		};
		expect(generatedCardSchema.safeParse(card).success).toBe(true);
	});

	it('accepts a body exactly at the old cap (480 chars)', () => {
		const card = {
			hook: 'A valid declarative hook.',
			body: 'a'.repeat(480),
			whyItMatters: 'It matters.',
			format: 'object_story',
			conceptTags: ['t'],
			sourceSpan: 'a'.repeat(30)
		};
		expect(generatedCardSchema.safeParse(card).success).toBe(true);
	});

	it('rejects a body exceeding the new sanity bound (2001 chars)', () => {
		const card = {
			hook: 'A valid declarative hook.',
			body: 'a'.repeat(2001),
			whyItMatters: 'It matters.',
			format: 'object_story',
			conceptTags: ['t'],
			sourceSpan: 'a'.repeat(30)
		};
		expect(generatedCardSchema.safeParse(card).success).toBe(false);
	});
});

describe('clampBody', () => {
	it('returns a short body (<=480) unchanged', () => {
		const short = 'This is a short body.';
		expect(clampBody(short)).toBe(short);
	});

	it('trims leading/trailing whitespace on a short body', () => {
		expect(clampBody('  hello.  ')).toBe('hello.');
	});

	it('given a multi-sentence body >480, returns only whole sentences, length <=480, ending at a sentence terminator', () => {
		// Two sentences each ~280 chars → total ~560 chars (> 480).
		const s1 = `${'The Romans used volcanic ash mixed with seawater to create concrete that could harden underwater, a technique that modern engineers are only now beginning to fully replicate and understand.'.padEnd(280, ' word')}`;
		const s2 = `${'This discovery has profound implications for sustainable construction materials that last for millennia without the carbon footprint of Portland cement.'.padEnd(280, ' more')}`;
		const body = `${s1.trimEnd()}. ${s2.trimEnd()}.`;
		// Make sure our fixture is actually over the cap.
		expect(body.length).toBeGreaterThan(BODY_MAX_CHARS);

		const result = clampBody(body);
		expect(result.length).toBeLessThanOrEqual(BODY_MAX_CHARS);
		// Must end at a sentence terminator (last char is . ! or ?)
		expect(result).toMatch(/[.!?]$/);
	});

	it('given a single sentence >480, returns <=480 with no mid-word cut', () => {
		// One very long sentence with no sentence terminator
		const longSentence = 'word '.repeat(120).trim(); // ~599 chars, no sentence terminator
		const result = clampBody(longSentence);
		expect(result.length).toBeLessThanOrEqual(BODY_MAX_CHARS);
		// Must not end mid-word: last character should be end of a word (letter/digit),
		// and the character right after the result in the original should be a space (or end).
		const charAfter = longSentence[result.length] ?? ' ';
		expect(charAfter).toBe(' ');
	});

	it('never returns more than max chars', () => {
		const body = 'This is one sentence. '.repeat(40); // well over 480
		const result = clampBody(body);
		expect(result.length).toBeLessThanOrEqual(BODY_MAX_CHARS);
	});

	it('handles a body that is exactly max chars', () => {
		const body = 'a'.repeat(BODY_MAX_CHARS);
		expect(clampBody(body)).toBe(body);
	});
});

describe('publishedDelta', () => {
	it('is 1 only for a published result', () => {
		expect(publishedDelta('published')).toBe(1);
		expect(publishedDelta('duplicate')).toBe(0);
		expect(publishedDelta('filtered')).toBe(0);
		expect(publishedDelta('validation_failed')).toBe(0);
		expect(publishedDelta('exists')).toBe(0);
		expect(publishedDelta('skipped')).toBe(0);
	});
});

describe('fillBudget', () => {
	it('a fresh topic (cardCount 0) needs the full target with 2 spare attempts', () => {
		expect(fillBudget(0, 3)).toEqual({ needed: 3, maxAttempts: 5 });
	});
	it('a partial topic only needs the remainder', () => {
		expect(fillBudget(1, 3)).toEqual({ needed: 2, maxAttempts: 4 });
		expect(fillBudget(2, 3)).toEqual({ needed: 1, maxAttempts: 3 });
	});
	it('an at/over-target topic needs nothing (never negative)', () => {
		expect(fillBudget(3, 3)).toEqual({ needed: 0, maxAttempts: 2 });
		expect(fillBudget(5, 3)).toEqual({ needed: 0, maxAttempts: 2 });
	});
});

describe('shouldKeepFilling', () => {
	it('continues until `needed` cards are published this run', () => {
		const budget = fillBudget(0, 3); // needed 3, maxAttempts 5
		expect(shouldKeepFilling(0, 0, budget)).toBe(true);
		expect(shouldKeepFilling(2, 4, budget)).toBe(true); // 2<3 published, 4<5 attempts
		expect(shouldKeepFilling(3, 3, budget)).toBe(false); // hit needed
	});
	it('stops once attempts are exhausted even if short of needed', () => {
		const budget = fillBudget(0, 3); // maxAttempts 5
		expect(shouldKeepFilling(1, 5, budget)).toBe(false); // attempts exhausted
	});
	it('partial re-run fills toward target — progress is published, not seeded hooks', () => {
		// Regression guard: a topic at cardCount=1 (so 1 prior hook seeds avoidHooks)
		// must still publish `needed`=2 more. Gating on published (not avoidHooks.length)
		// keeps the loop alive past the seeded count.
		const budget = fillBudget(1, 3); // needed 2, maxAttempts 4
		expect(shouldKeepFilling(0, 0, budget)).toBe(true); // start: owe 2
		expect(shouldKeepFilling(1, 2, budget)).toBe(true); // published 1, owe 1 more
		expect(shouldKeepFilling(2, 3, budget)).toBe(false); // published 2 == needed → done at TARGET
	});
});
