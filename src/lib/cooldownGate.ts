/**
 * Re-entrancy guard for a destructive, position-stationary action.
 *
 * The feed dismisses ("not interested") instantly: the next card snaps into the
 * identical layout slot under a stationary cursor, so the dismiss button keeps
 * the same screen coordinates. A double-click — or an impatient second click —
 * therefore lands on the *next* card and dismisses two cards from one gesture.
 *
 * `cooldownGate(ms)` returns a function that admits a call only when at least
 * `ms` have passed since the last *admitted* call (rejected calls don't reset
 * the clock, so a burst can't keep the gate shut forever). The clock is
 * injectable for deterministic tests.
 */
export function cooldownGate(
	ms: number,
	now: () => number = () => performance.now()
): () => boolean {
	let lastAdmitted = -Infinity;
	return () => {
		const t = now();
		if (t - lastAdmitted < ms) return false;
		lastAdmitted = t;
		return true;
	};
}
