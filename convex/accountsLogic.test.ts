import { describe, expect, it } from 'vitest';
import { decideLink } from './accountsLogic';

describe('decideLink', () => {
	it('claims the device as the principal on first sign-in (no account yet)', () => {
		expect(decideLink(null, 'devA')).toEqual({ principal: 'devA', action: 'claim' });
	});
	it('is a no-op when the device already IS the principal', () => {
		expect(decideLink('devA', 'devA')).toEqual({ principal: 'devA', action: 'noop' });
	});
	it('merges when signing in on a different device', () => {
		expect(decideLink('devA', 'devB')).toEqual({ principal: 'devA', action: 'merge' });
	});
});
