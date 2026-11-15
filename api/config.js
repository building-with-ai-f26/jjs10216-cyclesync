// GET /api/config: settings the page needs that come from .env.
// Only the PUBLIC PostHog project key (it's meant to be in web pages).
// No key → { posthog: null }, and the page runs without analytics.
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

export function GET() {
  const key = process.env.POSTHOG_KEY?.trim();
  if (!key) return Response.json({ posthog: null });

  let host = process.env.POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST;
  if (!host.startsWith('https://')) host = DEFAULT_POSTHOG_HOST;
  return Response.json({ posthog: { key, host: host.replace(/\/+$/, '') } });
}
