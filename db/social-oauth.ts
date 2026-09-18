import { env } from 'cloudflare:workers';
import { connectTicket, connectTicketHash, decrypt, encrypt, persistConnectedTicket } from '@/db/social-connections';
import { TelegramStorageError } from '@/db/telegram-onboarding';
import { inspectAccess, verifyReadAccess, SocialApiError } from '@/lib/social-api.mjs';
import { authorizationUrl, digest, exchangeCode, oauthProviders, providerFor, randomHex } from '@/lib/social-oauth.mjs';

type Session = { stateHash: string; ticketHash: string; browserHash: string; provider: string; ciphertext: string; status: string; message: string | null; expiresAt: string };
export const cookieName = (state: string) => `__Host-kz-oauth-${state.slice(0, 16)}`;
export const sessionCookie = (state: string, secret: string, clear = false) => `${cookieName(state)}=${secret}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : 600}`;
export function browserSecret(request: Request, state: string) {
  const name = cookieName(state);
  return request.headers.get('cookie')?.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
async function session(state: string, secret: string) {
  if (!/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(secret)) throw new TelegramStorageError('Откройте подключение в том же браузере, где начали. Если окно закрыто — получите новую ссылку в боте.', 403);
  const row = await env.DB.prepare(`SELECT state_hash AS stateHash,ticket_hash AS ticketHash,browser_hash AS browserHash,provider,ciphertext,status,message,expires_at AS expiresAt
    FROM social_oauth_sessions WHERE state_hash=? AND browser_hash=? AND expires_at>?`).bind(await digest(state), await digest(secret), new Date().toISOString()).first<Session>();
  if (!row) throw new TelegramStorageError('Попытка истекла или отменена. Получите новую ссылку в боте.', 410);
  return row;
}
export async function startOAuth(token: string) {
  const ticket = await connectTicket(token);
  const provider = providerFor(ticket.platformName);
  if (!provider) throw new TelegramStorageError('Для этой площадки вход не нужен.', 400);
  const state = randomHex(); const secret = randomHex(); const verifier = randomHex();
  const url = await authorizationUrl(provider, env, state, verifier);
  const cipher = await encrypt({ verifier }, ticket.creatorId, ticket.channelId, `oauth:${await digest(state)}`);
  const now = new Date().toISOString();
  // A unique ticket session and transactional batch fence repeated Start clicks.
  let results;
  try { results = await env.DB.batch([
    env.DB.prepare('DELETE FROM social_oauth_sessions WHERE expires_at<?').bind(now),
    env.DB.prepare('UPDATE social_connect_tickets SET consumed=2 WHERE token_hash=? AND consumed=0 AND expires_at>?').bind(ticket.tokenHash, now),
    env.DB.prepare(`INSERT INTO social_oauth_sessions(state_hash,ticket_hash,browser_hash,provider,ciphertext,status,expires_at)
      SELECT ?,token_hash,?,?,?,'pending',expires_at FROM social_connect_tickets WHERE token_hash=? AND consumed=2 AND expires_at>?`)
      .bind(await digest(state), await digest(secret), provider, cipher, ticket.tokenHash, now),
  ]); } catch { throw new TelegramStorageError('Подключение уже начато или ссылка заменена. Завершите вход в открытом окне либо получите новую ссылку.', 409); }
  if (results[1].meta.changes !== 1 || results[2].meta.changes !== 1) throw new TelegramStorageError('Подключение уже начато. Завершите его в открытом окне.', 409);
  return { url, cookie: sessionCookie(state, secret), state };
}
export async function finishOAuth(provider: string, params: Record<string, string>, secret: string) {
  const row = await session(params.state, secret);
  if (row.provider !== provider || !Object.hasOwn(oauthProviders, provider)) throw new TelegramStorageError('Площадка авторизации не совпадает.', 403);
  if (['complete', 'error', 'cancelled'].includes(row.status)) return;
  const claim = await env.DB.prepare("UPDATE social_oauth_sessions SET status='exchanging' WHERE state_hash=? AND status='pending'").bind(row.stateHash).run();
  if (claim.meta.changes !== 1) throw new TelegramStorageError('Ответ уже обрабатывается. Вернитесь в бот и проверьте канал.', 409);
  try {
    const ticket = await connectTicketHash(row.ticketHash, 2);
    if (params.error) {
      await env.DB.prepare("UPDATE social_oauth_sessions SET status='cancelled',ciphertext='',message='Вы отменили авторизацию. Прежний доступ и канал сохранены.' WHERE state_hash=?").bind(row.stateHash).run();
      return;
    }
    const saved = await decrypt({ ...ticket, accountId: `oauth:${row.stateHash}`, ciphertext: row.ciphertext });
    const result = await exchangeCode(provider, env, params, saved.verifier);
    const identity = await inspectAccess(ticket, result.credentials);
    if (!identity?.accountId) throw new SocialApiError('Площадка не подтвердила владельца доступа. Подключите аккаунт заново.');
    // Instagram code exchange returns the app-scoped ID (/me.id), while metrics
    // and the vault are keyed by the professional IG ID (/me.user_id).
    const exchangedIdentity = provider === 'instagram' ? String(('profile' in identity && identity.profile?.id) || '') : identity.accountId;
    if (exchangedIdentity !== result.accountId) throw new SocialApiError('Площадка вернула другой аккаунт. Прежний доступ сохранён.');
    await verifyReadAccess(ticket, result.credentials);
    await connectTicketHash(row.ticketHash, 2);
    const consumed = await env.DB.prepare('UPDATE social_connect_tickets SET consumed=1 WHERE token_hash=? AND consumed=2 AND expires_at>?').bind(row.ticketHash, new Date().toISOString()).run();
    if (consumed.meta.changes !== 1) throw new TelegramStorageError('Канал или попытка подключения изменены.', 409);
    await persistConnectedTicket(row.ticketHash, result.credentials, identity, result.expiresAt, new Date().toISOString(), row.stateHash);
  } catch (error) {
    const message = error instanceof TelegramStorageError || error instanceof SocialApiError ? error.message : 'Временная ошибка подключения. Получите новую ссылку в боте. Прежний доступ сохранён.';
    await env.DB.prepare("UPDATE social_oauth_sessions SET status='error',ciphertext='',message=? WHERE state_hash=? AND status='exchanging'").bind(message, row.stateHash).run();
  }
}
export async function oauthResult(state: string, secret: string) {
  const row = await session(state, secret);
  const target = await env.DB.prepare(`SELECT ch.id AS channelId FROM social_connect_tickets t
    JOIN creator_channels ch ON ch.id=t.channel_id AND ch.creator_id=t.creator_id
    WHERE t.token_hash=? AND ch.deleted_at IS NULL`).bind(row.ticketHash).first<{ channelId: number }>();
  return { status: row.status, channelId: target?.channelId, message: row.message || 'Подключение ещё обрабатывается. Проверьте состояние канала в боте.' };
}
