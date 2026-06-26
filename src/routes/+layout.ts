import { dev } from '$app/environment';
import { injectAnalytics } from '@vercel/analytics/sveltekit';
import { injectSpeedInsights } from '@vercel/speed-insights/sveltekit';

// Vercel observability, injected once at the root layout so it runs on every
// route. Both helpers no-op during SSR and only attach in the browser.
injectAnalytics({ mode: dev ? 'development' : 'production' });
injectSpeedInsights();
