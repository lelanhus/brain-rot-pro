import { browser } from '$app/environment';

/**
 * Theme preference (UI/UX §9: light mode on top of the verified dark tokens).
 * Three states: `system` follows `prefers-color-scheme`; `light`/`dark` force it
 * via a `data-theme` attribute on <html>. The initial paint is set by a tiny
 * inline script in app.html (no flash); this store handles user changes after.
 */
export type Theme = 'system' | 'light' | 'dark';

const KEY = 'brp_theme';

function read(): Theme {
	if (!browser) return 'system';
	const stored = localStorage.getItem(KEY);
	return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function apply(theme: Theme) {
	if (!browser) return;
	const root = document.documentElement;
	if (theme === 'system') root.removeAttribute('data-theme');
	else root.dataset.theme = theme;
}

let theme = $state<Theme>(read());

export const themeStore = {
	get value() {
		return theme;
	},
	set(next: Theme) {
		theme = next;
		if (browser) localStorage.setItem(KEY, next);
		apply(next);
	}
};
