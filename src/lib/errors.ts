/** A user-facing message from an unknown thrown value, falling back when it isn't an Error. */
export function errorMessage(err: unknown, fallback: string): string {
	return err instanceof Error ? err.message : fallback;
}
