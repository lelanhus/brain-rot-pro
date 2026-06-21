import { describe, expect, it } from 'vitest';
import {
	BODY_MAX_CHARS,
	buildGenerationPrompt,
	clampBody,
	decidePublish,
	generatedCardSchema,
	spanIsFromSource
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
