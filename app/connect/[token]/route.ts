import { env } from 'cloudflare:workers';
import { connectTicket, publicOrigin, saveConnectTicket } from '@/db/social-connections';
import { startOAuth } from '@/db/social-oauth';
import { socialInstructions } from '@/lib/social-instructions.mjs';
import { integrationStatus, providerFor } from '@/lib/social-oauth.mjs';
import { TelegramStorageError } from '@/db/telegram-onboarding';
import { connectionFormPage as page, connectionProblem as problem, escapeHtml as escape, boundedForm, cleanRedirect } from '@/lib/server/connection-page';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ token: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { token } = await context.params;
    const ticket = await connectTicket(token);
    const info = socialInstructions[ticket.platformName as keyof typeof socialInstructions];
    const status = integrationStatus(env).find((p) => p.platform === ticket.platformName)!;
    const oauth = providerFor(ticket.platformName);
    const afterSave = ticket.channelStatus === 'inactive'
      ? 'Сбор этого канала приостановлен. После подключения вернитесь в бот → «Настройки» → «Управление каналом» → «Возобновить сбор».'
      : 'После подключения первая проверка статистики автоматически попадёт в очередь.';
    const nextStep = (oauth && status.ready) || ticket.channelStatus === 'inactive' ? `<p>${afterSave}</p>` : '';
    const loginName = ticket.platformName === 'YouTube' ? 'Google' : ticket.platformName === 'VK' ? 'VK ID' : ticket.platformName;
    return page(`<h1>Подключить ${escape(ticket.platformName)}</h1><p>Канал: <code>${escape(ticket.url)}</code></p><p>Доступ сохранится за вашим Telegram и этим каналом. Войдите в аккаунт владельца и выберите именно этот канал. Ссылка действует 10 минут — не пересылайте её.</p>${oauth && status.ready ? `<form method="post" action="/connect/${token}"><input type="hidden" name="action" value="oauth"><button type="submit">Войти через ${escape(loginName)}</button></form><p class="muted">Вы перейдёте на официальный сайт ${escape(loginName)}. Разрешите чтение статистики и завершите вход в том же браузере. Пароль вводится только на сайте соцсети; создавать или копировать API-ключи не нужно.</p>` : '<div class="notice">Официальный вход ещё не настроен администратором или ожидает разрешений площадки. Канал сохранён. Передайте администратору название соцсети и ссылку канала; после настройки вернитесь к карточке в боте. Повторно добавлять ссылку не нужно.</div>'}${nextStep}<details><summary>Инструкция и ограничения</summary><ol>${info.steps.map((s) => `<li>${escape(s)}</li>`).join('')}</ol><a href="${escape(info.docs)}" target="_blank" rel="noreferrer">Документация площадки</a></details><nav><a href="/api-guide">Гайд по подключению</a><a href="/integration-info/privacy">Данные и конфиденциальность</a><a href="https://t.me/contentlsbot">Назад в бот</a></nav>`);
  } catch (error) { return problem(error); }
}
export async function POST(request: Request, context: Context) {
  const { token } = await context.params;
  try {
    if (request.headers.get('origin') !== publicOrigin()) throw new TelegramStorageError('Недопустимый источник запроса', 403);
    const input = await boundedForm(request);
    if (input.action === 'oauth') {
      const result = await startOAuth(token);
      return cleanRedirect(result.url, result.cookie);
    }
    if (input.action && input.action !== 'manual') throw new TelegramStorageError('Неизвестное действие', 400);
    const saved = await saveConnectTicket(token, input);
    return cleanRedirect(`/connect/success?channel=${saved.channelId}${saved.channelStatus === 'inactive' ? '&paused=1' : ''}`);
  } catch (error) {
    // OAuth consumes the ticket before leaving this page. Offer correction only
    // when the form is still usable, including released manual-validation attempts.
    const retryPath = await connectTicket(token).then(() => `/connect/${token}`).catch(() => undefined);
    return problem(error, retryPath);
  }
}
