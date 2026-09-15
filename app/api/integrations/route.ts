import { env } from 'cloudflare:workers';
import { integrationStatus, configuredOrigin } from '@/lib/social-oauth.mjs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const origin = configuredOrigin(env);
  return Response.json({ providers: integrationStatus(env), guideUrl: origin ? `${origin}/api-guide` : null,
    productUrl: origin ? `${origin}/integration-info/overview` : null, privacyUrl: origin ? `${origin}/integration-info/privacy` : null,
    termsUrl: origin ? `${origin}/integration-info/terms` : null, deletionUrl: origin ? `${origin}/integration-info/deletion` : null,
    note: 'Настройки не подтверждают одобрение приложения соцсетью. Перед массовым запуском пройдите авторизацию реальным аккаунтом и проверьте первый сбор.' }, { headers: { 'Cache-Control': 'no-store' } });
}
