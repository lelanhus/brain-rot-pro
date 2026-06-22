const KEY = 'brp:onboarded';

/** SSR-safe: returns true during SSR so the overlay never flashes server-side. */
export function isOnboarded(): boolean {
	if (typeof localStorage === 'undefined') return true;
	return localStorage.getItem(KEY) === '1';
}

export function markOnboarded(): void {
	if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, '1');
}
