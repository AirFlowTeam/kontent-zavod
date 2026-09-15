import { browserSecret, finishOAuth } from '@/db/social-oauth';
import { callbackParams } from '@/lib/social-oauth.mjs';
import { cleanRedirect, connectionProblem } from '@/lib/server/connection-page';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await context.params;
    const params = callbackParams(provider, request.url);
    await finishOAuth(provider, params, browserSecret(request, params.state));
    return cleanRedirect(`/connect/result/${params.state}`);
  } catch (error) { return connectionProblem(error); }
}
