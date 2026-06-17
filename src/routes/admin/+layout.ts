// Admin is an auth-gated internal tool (ADR-009): render client-side only. This
// avoids SSR'ing the shell and prevents a hydration mismatch — the gate reads
// the token from localStorage, which only exists in the browser.
export const ssr = false;
