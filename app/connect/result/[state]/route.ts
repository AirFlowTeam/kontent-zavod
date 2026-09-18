import { browserSecret, oauthResult } from '@/db/social-oauth';
import { botChannelLink, connectionPage, connectionProblem, escapeHtml } from '@/lib/server/connection-page';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ state: string }> }) {
  try {
    const { state } = await context.params;
    const result = await oauthResult(state, browserSecret(request, state));
    return connectionPage(`<h1>${result.status === 'complete' ? 'Доступ подключён' : result.status === 'cancelled' ? 'Вход отменён' : result.status === 'error' ? 'Нужно повторить подключение' : 'Проверяем доступ'}</h1><p>${escapeHtml(result.message)}</p>${botChannelLink(result.channelId)}`);
  } catch (error) { return connectionProblem(error); }
}
