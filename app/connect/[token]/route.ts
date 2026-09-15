import { env } from 'cloudflare:workers';
import { connectTicket, publicOrigin, saveConnectTicket } from '@/db/social-connections';
import { startOAuth } from '@/db/social-oauth';
import { socialInstructions } from '@/lib/social-instructions.mjs';
import { integrationStatus } from '@/lib/social-oauth.mjs';
import { TelegramStorageError } from '@/db/telegram-onboarding';
import { connectionPage as page, connectionProblem as problem, escapeHtml as escape, boundedForm, cleanRedirect } from '@/lib/server/connection-page';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ token: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { token } = await context.params;
    const ticket = await connectTicket(token);
    const info = socialInstructions[ticket.platformName as keyof typeof socialInstructions];
    const status = integrationStatus(env).find((p) => p.platform === ticket.platformName)!;
    const oauth = ['Instagram', 'Threads', 'TikTok', 'VK'].includes(ticket.platformName);
    const manualAvailable = ticket.platformName !== 'TikTok' || (Reflect.get(env, 'TIKTOK_CLIENT_KEY') && Reflect.get(env, 'TIKTOK_CLIENT_SECRET'));
    const fields = `<form method="post" action="/connect/${token}" autocomplete="off"><input type="hidden" name="action" value="manual"><label>Access token / API key<input name="accessToken" type="password" required maxlength="8192" autocomplete="new-password" spellcheck="false"></label>${['TikTok','VK'].includes(ticket.platformName) ? '<label>Refresh token<input name="refreshToken" type="password" required maxlength="8192" autocomplete="new-password"></label>' : ''}${ticket.platformName === 'VK' ? '<label>Client ID приложения VK ID<input name="clientId" required maxlength="100"></label><label>Device ID из авторизации VK ID<input name="deviceId" type="password" required maxlength="8192"></label>' : ''}<p><small>Не вводите пароль соцсети, cookies, client_secret или токен Telegram-бота.</small></p><button type="submit">Проверить и подключить</button></form>`;
    return page(`<h1>Подключить ${escape(ticket.platformName)}</h1><p>Канал: <code>${escape(ticket.url)}</code></p><p>Доступ сохранится за вашим Telegram и этим каналом. Откройте аккаунт владельца. Ссылка одноразовая, на 10 минут — не пересылайте её.</p>${oauth ? status.ready ? `<form method="post" action="/connect/${token}"><input type="hidden" name="action" value="oauth"><button type="submit">Войти через ${escape(ticket.platformName === 'VK' ? 'VK ID' : ticket.platformName)}</button></form><p class="muted">Войдите на официальном сайте и разрешите чтение статистики. Ключи подставятся автоматически. Завершите вход в том же браузере.</p>` : '<div class="notice">Вход через эту соцсеть ещё не включён администратором. Канал уже сохранён. Сообщите продюсеру, какую площадку нужно подключить; повторно добавлять канал не нужно.</div>' : `<p>Личный YouTube Data API key вводит сам креатор. Он сохранится только за вами и выбранным каналом; не пересылайте его продюсеру.</p>`}${oauth ? `<details><summary>У меня уже есть готовый токен</summary>${['Instagram', 'Threads'].includes(ticket.platformName) ? '<p>Для ручного ввода нужен действующий long-lived токен старше суток: проверяем возможность его продления. Свежий токен подключайте кнопкой входа.</p>' : ''}${manualAvailable ? fields : '<p>Для импорта TikTok сначала нужны настройки приложения на сервере. Обратитесь к администратору.</p>'}</details>` : fields}<details><summary>Инструкция и ограничения</summary><ol>${info.steps.map((s) => `<li>${escape(s)}</li>`).join('')}</ol><a href="${escape(info.docs)}" target="_blank" rel="noreferrer">Документация площадки</a></details><nav><a href="/api-guide">Гайд по подключению</a><a href="/integration-info/privacy">Данные и конфиденциальность</a><a href="https://t.me/contentlsbot">Назад в бот</a></nav>`);
  } catch (error) { return problem(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    if (request.headers.get('origin') !== publicOrigin()) throw new TelegramStorageError('Недопустимый источник запроса', 403);
    const input = await boundedForm(request);
    const { token } = await context.params;
    if (input.action === 'oauth') {
      const result = await startOAuth(token);
      return cleanRedirect(result.url, result.cookie);
    }
    if (input.action && input.action !== 'manual') throw new TelegramStorageError('Неизвестное действие', 400);
    await saveConnectTicket(token, input);
    return cleanRedirect('/connect/success');
  } catch (error) { return problem(error); }
}
