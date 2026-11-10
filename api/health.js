// GET /api/health: a quick "is the server working?" check.
export function GET() {
  return Response.json({ ok: true });
}
