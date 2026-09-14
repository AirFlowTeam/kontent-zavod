import { env } from 'cloudflare:workers';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const revision = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM telegram_accounts) AS accounts,
      (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM creator_channels) AS channels,
      (SELECT COUNT(*) FROM creators) AS creators,
      (SELECT COUNT(*) FROM producers) AS producers`).first();
    return Response.json({ revision: JSON.stringify(revision) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Не удалось проверить обновления' }, { status: 503 });
  }
}
