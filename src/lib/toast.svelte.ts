/**
 * Reusable transient-toast state (Svelte 5 rune module). Owns its own dismiss
 * timer so components don't hand-roll the lifecycle. `id` increments per `show`
 * so a `{#key toast.id}` block re-triggers the entry animation even when the
 * same message repeats.
 */
export function createToast(defaultMs = 2600) {
	let message = $state<string | null>(null);
	let id = $state(0);
	let timer: ReturnType<typeof setTimeout> | null = null;

	function show(text: string, ms = defaultMs) {
		message = text;
		id += 1;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => (message = null), ms);
	}

	/** Clear the toast and its timer (call from the component's teardown). */
	function dismiss() {
		if (timer) clearTimeout(timer);
		timer = null;
		message = null;
	}

	return {
		get message() {
			return message;
		},
		get id() {
			return id;
		},
		show,
		dismiss
	};
}
