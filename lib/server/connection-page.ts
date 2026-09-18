import { TelegramStorageError } from '@/db/telegram-onboarding';
import { SocialApiError } from '@/lib/social-api.mjs';
export const escapeHtml = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '').replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]!);
export const privateHeaders = { 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow' };
export function connectionPage(content: string, status = 200) {
  return new Response(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Подключение соцсетей · Контент-завод</title><style>body{font:17px/1.6 system-ui,sans-serif;background:#f8f7f0;color:#20242f;margin:0}main{max-width:720px;margin:30px auto;background:white;padding:28px;border-radius:24px}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #bbb;border-radius:8px;margin:6px 0 18px;font:inherit}button,.button{display:inline-block;padding:14px 22px;background:#6549ca;border:0;border-radius:10px;color:white;font:inherit;cursor:pointer;text-decoration:none}li{margin-bottom:12px}small,.muted{color:#626879}h1{font-size:26px;line-height:1.25}h2{font-size:21px}a{color:#6549ca}code{overflow-wrap:anywhere}details{border:1px solid #dedde5;border-radius:12px;padding:16px;margin-top:22px}summary{cursor:pointer;font-weight:600}.notice{border-left:4px solid #c78e30;padding:12px 16px;background:#fff8e9;margin:16px 0}nav{display:flex;gap:16px;flex-wrap:wrap;margin-top:26px}@media(max-width:760px){main{margin:12px;padding:20px}}</style></head><body><main>${content}</main></body></html>`, { status, headers: { ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://accounts.google.com https://www.instagram.com https://www.tiktok.com https://id.vk.ru https://threads.com https://www.threads.com; frame-ancestors 'none'; base-uri 'none'" } });
}
export function connectionFormPage(content: string, status = 200) {
  const response = connectionPage(content, status);
  // no-referrer makes browser form POSTs send Origin:null. strict-origin keeps
  // the exact origin for CSRF checks without exposing the ticket path in Referer.
  response.headers.set('Referrer-Policy', 'strict-origin');
  return response;
}
export const botLink = '<p><a class="button" href="https://t.me/contentlsbot?start=check">Вернуться в бот и проверить результат</a></p><p>Бот откроет канал, которому нужна проверка. Нажмите «Обновить результат». Если данных нет, выполните следующий шаг под каналом или откройте «Помощь».</p>';
export function botChannelLink(channelId: unknown) {
  return typeof channelId === 'number' && Number.isSafeInteger(channelId) && channelId > 0
    ? botLink.replace('start=check', `start=check_${channelId}`) : botLink;
}
export function connectionProblem(error: unknown, retryPath?: string) {
  const safe = error instanceof TelegramStorageError || error instanceof SocialApiError;
  const retry = retryPath && /^\/connect\/[a-f0-9]{64}$/.test(retryPath) && !(error instanceof TelegramStorageError && error.statusCode === 410)
    ? `<p><a href="${retryPath}">Исправить данные в этой форме</a></p><p>Форма действует до истечения 10 минут. Если вы уже открыли новую ссылку в боте, используйте её.</p>` : '';
  return connectionPage(`<h1>Не удалось подключить доступ</h1><p>${escapeHtml(safe ? error.message : 'Временная ошибка. Получите новую ссылку в боте и попробуйте ещё раз.')}</p>${retry}${botLink}`, safe ? error.statusCode : 503);
}
export function cleanRedirect(path: string, cookie?: string) {
  return new Response(null, { status: 303, headers: { ...privateHeaders, Location: path, ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}
export async function boundedForm(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded') throw new TelegramStorageError('Недопустимый формат', 415);
  if (Number(request.headers.get('content-length')) > 32768) throw new TelegramStorageError('Слишком большой запрос', 413);
  const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  if (reader) for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 32768) { await reader.cancel(); throw new TelegramStorageError('Слишком большой запрос', 413); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const fields = new URLSearchParams(new TextDecoder().decode(bytes));
  for (const key of fields.keys()) if (fields.getAll(key).length !== 1) throw new TelegramStorageError('Повторяющееся поле формы', 400);
  return Object.fromEntries(fields);
}
