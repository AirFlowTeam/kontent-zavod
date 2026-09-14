import { connectTicket, publicOrigin, saveConnectTicket } from '@/db/social-connections';
import { socialInstructions } from '@/lib/social-instructions.mjs';
import { TelegramStorageError } from '@/db/telegram-onboarding';
import { SocialApiError } from '@/lib/social-api.mjs';
export const dynamic = 'force-dynamic';
const escape = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]!);
function page(content: string, status = 200) {
  return new Response(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Подключить соцсеть · Контент-завод</title><style>body{font:17px/1.6 system-ui,sans-serif;background:#f8f7f0;color:#20242f;margin:0}main{max-width:650px;margin:30px auto;background:white;padding:28px;border-radius:24px}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #bbb;border-radius:8px;margin:6px 0 18px;font:inherit}button{padding:14px 22px;background:#6549ca;border:0;border-radius:10px;color:white;font:inherit;cursor:pointer}li{margin-bottom:12px}small{color:#626879}h1{font-size:26px;line-height:1.25}a{color:#6549ca}code{overflow-wrap:anywhere}@media(max-width:700px){main{margin:12px;padding:20px}}</style></head><body><main>${content}</main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", 'X-Robots-Tag': 'noindex, nofollow' } });
}
function problem(error: unknown) {
  const safe = error instanceof TelegramStorageError || error instanceof SocialApiError;
  return page(`<h1>Не удалось подключить доступ</h1><p>${escape(safe ? error.message : 'Временная ошибка. Получите новую ссылку в боте и попробуйте ещё раз. Прежний доступ не изменён.')}</p><p><a href="https://t.me/contentlsbot">Вернуться в бот</a> → /channels → Подключить API.</p>`, safe ? error.statusCode : 503);
}
type Context = { params: Promise<{ token: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { token } = await context.params;
    const ticket = await connectTicket(token);
    const info = socialInstructions[ticket.platformName as keyof typeof socialInstructions];
    return page(`<h1>${escape(info.title)}</h1><p>Канал: <code>${escape(ticket.url)}</code></p><p>Персональная одноразовая форма на 10 минут. Не пересылайте ссылку. Доступ закрепится за вашим Telegram и этим каналом; токен не публикуется в админке или переписке.</p><ol>${info.steps.map((s) => `<li>${escape(s)}</li>`).join('')}</ol><p><a href="${escape(info.docs)}" target="_blank" rel="noreferrer">Официальная документация</a></p><form method="post" action="/connect/${token}" autocomplete="off"><label>Access token / API key<input name="accessToken" type="password" required maxlength="8192" autocomplete="new-password" spellcheck="false"></label>${['TikTok','VK'].includes(ticket.platformName) ? '<label>Refresh token<input name="refreshToken" type="password" required maxlength="8192" autocomplete="new-password"></label>' : ''}${ticket.platformName === 'VK' ? '<label>Client ID приложения VK ID<input name="clientId" required maxlength="100"></label><label>Device ID из авторизации VK ID<input name="deviceId" type="password" required maxlength="8192"></label>' : ''}<p><small>Не вводите пароль соцсети, cookies, client_secret или токен Telegram-бота.</small></p><button type="submit">Проверить и подключить</button></form>`);
  } catch (error) { return problem(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    if (request.headers.get('origin') !== publicOrigin()) return page('<h1>Недопустимый источник запроса</h1>', 403);
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded') return page('<h1>Недопустимый формат</h1>', 415);
    if (Number(request.headers.get('content-length')) > 32768) return page('<h1>Слишком большой запрос</h1>', 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 32768) return page('<h1>Слишком большой запрос</h1>', 413);
    const { token } = await context.params;
    const result = await saveConnectTicket(token, Object.fromEntries(new URLSearchParams(raw)));
    return page(`<h1>Доступ подключён</h1><p>${escape(result.platformName)} · ${escape(result.username)}</p><p>Канал поставлен в очередь на первую проверку. Затем обновляем ежедневно. Если площадка не разрешит отдельные показатели, это будет видно в статусе — недоступные значения не станут нулями.</p><p><a href="https://t.me/contentlsbot">Вернуться в бот</a> → Мои каналы.</p>`);
  } catch (error) { return problem(error); }
}
