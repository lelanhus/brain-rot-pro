import { describe, it, expect } from 'vitest';
import { cooldownGate } from '$lib/cooldownGate';

describe('cooldownGate', () => {
	it('admits the first call', () => {
		const gate = cooldownGate(350, () => 0);
		expect(gate()).toBe(true);
	});

	it('rejects a second call inside the cooldown window', () => {
		let now = 0;
		const gate = cooldownGate(350, () => now);
		expect(gate()).toBe(true); // t=0 admitted
		now = 349;
		expect(gate()).toBe(false); // accidental double-click swallowed
	});

	it('admits again once the window has elapsed', () => {
		let now = 0;
		const gate = cooldownGate(350, () => now);
		expect(gate()).toBe(true);
		now = 350;
		expect(gate()).toBe(true); // deliberate, paced action allowed
	});

	it('measures the window from the last admitted call, not the last attempt', () => {
		let now = 0;
		const gate = cooldownGate(350, () => now);
		expect(gate()).toBe(true); // t=0 admitted
		now = 200;
		expect(gate()).toBe(false); // rejected; must not reset the clock
		now = 400; // 400ms after the admitted call, only 200 after the rejected one
		expect(gate()).toBe(true);
	});
});
