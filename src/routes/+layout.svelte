<script lang="ts">
	import '../app.css';
	import { setupConvex } from 'convex-svelte';
	import { env } from '$env/dynamic/public';

	let { children } = $props();

	// Reuses the singleton created by initConvex() in hooks.ts; the URL is already
	// validated there, so a missing value would have failed loudly before this runs.
	setupConvex(env.PUBLIC_CONVEX_URL ?? '');
</script>

{@render children()}
