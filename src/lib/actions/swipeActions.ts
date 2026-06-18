import type { Action } from 'svelte/action';

/**
 * Horizontal swipe-to-act on a feed card (ui-ux.md §5: thumb-first, zero
 * precision). Swipe right past the threshold → save; swipe left → not-interested.
 *
 * Scroll-safety: the host element must set `touch-action: pan-y`, so the browser
 * keeps owning vertical scroll and only horizontal-dominant gestures reach these
 * pointer handlers. We lock to an axis after a small slop and bail to the browser
 * the moment a gesture is vertical — so swipe never fights the feed's scroll.
 *
 * Visual feedback is driven by `data-swipe` ("save"/"dismiss") + the
 * `--swipe-progress` (0–1) custom property the action sets on the node (styled in
 * app.css). Honors prefers-reduced-motion for the release animations.
 */
type Params = { onSave: () => void; onDismiss: () => void };

const LOCK_SLOP = 10; // px of movement before the gesture commits to an axis
const COMMIT_FRACTION = 0.26; // of viewport width to trigger an action
const COMMIT_MAX = 120; // …but never demand more than this many px

export const swipeActions: Action<HTMLElement, Params> = (node, params) => {
	let current = params;
	let startX = 0;
	let startY = 0;
	let dx = 0;
	let axis: 'horizontal' | 'vertical' | null = null;
	let tracking = false;

	const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	const commitDistance = (): number => Math.min(COMMIT_MAX, window.innerWidth * COMMIT_FRACTION);

	function settle(animate: boolean): void {
		node.style.transition = animate && !reduceMotion.matches ? 'transform 200ms var(--ease)' : '';
		node.style.transform = '';
		node.removeAttribute('data-swipe');
		node.style.removeProperty('--swipe-progress');
	}

	function onPointerDown(e: PointerEvent): void {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		startX = e.clientX;
		startY = e.clientY;
		dx = 0;
		axis = null;
		tracking = true;
		node.style.transition = 'none';
	}

	function onPointerMove(e: PointerEvent): void {
		if (!tracking) return;
		const moveX = e.clientX - startX;
		const moveY = e.clientY - startY;

		if (axis === null) {
			if (Math.abs(moveX) < LOCK_SLOP && Math.abs(moveY) < LOCK_SLOP) return;
			if (Math.abs(moveX) > Math.abs(moveY)) {
				axis = 'horizontal';
				node.setPointerCapture(e.pointerId);
			} else {
				axis = 'vertical'; // hand the gesture back to native vertical scroll
				tracking = false;
				return;
			}
		}

		dx = moveX;
		node.style.transform = `translateX(${dx}px)`;
		node.dataset.swipe = dx > 0 ? 'save' : 'dismiss';
		node.style.setProperty(
			'--swipe-progress',
			String(Math.min(1, Math.abs(dx) / commitDistance()))
		);
	}

	function onPointerUp(): void {
		if (axis !== 'horizontal') {
			tracking = false;
			return;
		}
		tracking = false;
		axis = null;

		if (Math.abs(dx) < commitDistance()) {
			settle(true); // spring back
			return;
		}

		if (dx > 0) {
			settle(true); // save keeps the card — spring it back, the bar flashes green
			current.onSave();
			return;
		}

		// Dismiss: fly the card off, then drop it from the feed once it's gone.
		const fly = (): void => current.onDismiss();
		if (reduceMotion.matches) {
			fly();
			settle(false);
			return;
		}
		node.style.transition = 'transform 200ms var(--ease), opacity 200ms var(--ease)';
		node.style.transform = 'translateX(-110%)';
		node.style.opacity = '0';
		node.addEventListener(
			'transitionend',
			() => {
				node.style.opacity = '';
				fly();
			},
			{ once: true }
		);
	}

	function onPointerCancel(): void {
		tracking = false;
		axis = null;
		settle(true);
	}

	node.addEventListener('pointerdown', onPointerDown);
	node.addEventListener('pointermove', onPointerMove);
	node.addEventListener('pointerup', onPointerUp);
	node.addEventListener('pointercancel', onPointerCancel);

	return {
		update(next: Params): void {
			current = next;
		},
		destroy(): void {
			node.removeEventListener('pointerdown', onPointerDown);
			node.removeEventListener('pointermove', onPointerMove);
			node.removeEventListener('pointerup', onPointerUp);
			node.removeEventListener('pointercancel', onPointerCancel);
		}
	};
};
