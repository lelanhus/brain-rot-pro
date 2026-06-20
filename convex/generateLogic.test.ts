import { describe, expect, it } from 'vitest';
import {
	buildGenerationPrompt,
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
});
