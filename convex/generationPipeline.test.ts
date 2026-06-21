import { expect, test } from 'vitest';
import { supplyThrottleOk } from './generationPipeline';

test('supplyThrottleOk respects the cooldown', () => {
	expect(supplyThrottleOk(undefined, 1000)).toBe(true);
	expect(supplyThrottleOk(1000, 1000 + 59_000)).toBe(false);
	expect(supplyThrottleOk(1000, 1000 + 60_000)).toBe(true);
});
