/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

/**
 * Offline support (UI/UX §7 — "offline: show a graceful state, not a crash").
 * SvelteKit auto-registers this in production builds. Strategy:
 *  - Precache the immutable app shell (build assets + static files) on install.
 *  - Cache-first for those assets (they're content-hashed → safe).
 *  - Network-first for navigations, falling back to a cached page, then an inline
 *    offline notice. We deliberately DON'T touch cross-origin requests (Convex
 *    WebSocket/HTTP, the AI gateway) — live data is owned by Convex, not cached.
 *
 * Full offline card-reading (persisting the feed to IndexedDB) is a larger
 * follow-up; this makes the installed PWA launch and degrade gracefully offline.
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `brp-cache-${version}`;
const PRECACHE = [...build, ...files];

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;
background:#0b0b0f;color:#f3f3f7;font-family:ui-sans-serif,system-ui,sans-serif;text-align:center;padding:2rem}
h1{font-size:1.3rem;margin:0 0 .5rem}p{color:#9a9aa8;line-height:1.5;margin:0}
</style></head><body><div><h1>You're offline</h1>
<p>Brain Rot Pro needs a connection for fresh cards.<br>Reconnect and we'll pick up where you left off.</p>
</div></body></html>`;

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return; // leave Convex / gateway alone

	// Content-hashed app shell: cache-first.
	if (PRECACHE.includes(url.pathname)) {
		event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
		return;
	}

	// Page navigations: network-first, fall back to cache, then an offline notice.
	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request).catch(
				async () =>
					(await caches.match(request)) ??
					new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
			)
		);
	}
});
