import { env } from 'cloudflare:workers';
import { telegramIdentity, requireTelegramCreatorReady, TelegramStorageError } from '@/db/telegram-onboarding';
import { inspectAccess, parseCredentials, refreshAccess, verifyReadAccess, SocialApiError } from '@/lib/social-api.mjs';

type Input = Record<string, unknown>;
type Ticket = { tokenHash: string; channelId: number; creatorId: number; telegramUserId: string; expiresAt: string; consumed: number; url: string; platformName: string; providerChannelId: string | null };
type Connection = { channelId: number; creatorId: number; accountId: string; ciphertext: string; updatedAt: string; expiresAt: string | null; refreshedAt: string | null; status: string };
const db = () => env.DB;
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (value: string) => Uint8Array.from(value.match(/.{2}/g) || [], (b) => parseInt(b, 16));
export const publicOrigin = () => {
  const raw = Reflect.get(env, 'CONTENT_PUBLIC_ORIGIN');
  if (typeof raw !== 'string' || !/^https:\/\/[^/]+$/.test(raw)) throw new TelegramStorageError('Публичный адрес формы не настроен администратором', 503);
  return new URL(raw).origin;
};
async function key() {
  const secret = Reflect.get(env, 'SOCIAL_VAULT_KEY');
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) throw new TelegramStorageError('Хранилище доступов не настроено администратором', 503);
  return crypto.subtle.importKey('raw', fromHex(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function hash(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new TelegramStorageError('Ссылка недействительна. Получите новую через /channels в боте.', 410);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
}
const aad = (creatorId: number, channelId: number, accountId: string) => new TextEncoder().encode(`social:v1:${creatorId}:${channelId}:${accountId}`);
export async function encrypt(value: unknown, creatorId: number, channelId: number, accountId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(creatorId, channelId, accountId) }, await key(), new TextEncoder().encode(JSON.stringify(value)));
  return `v1.${hex(iv)}.${hex(new Uint8Array(ciphertext))}`;
}
export async function decrypt(row: Pick<Connection, 'ciphertext' | 'creatorId' | 'channelId' | 'accountId'>) {
  const [version, iv, cipher] = row.ciphertext.split('.');
  if (version !== 'v1' || !iv || !cipher) throw new Error('Invalid vault record');
  const value = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(iv), additionalData: aad(row.creatorId, row.channelId, row.accountId) }, await key(), fromHex(cipher));
  return JSON.parse(new TextDecoder().decode(value));
}
async function ownedChannel(input: Input) {
  const identity = telegramIdentity(input);
  const owner = await requireTelegramCreatorReady(identity.id);
  const id = Number(input.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TelegramStorageError('Некорректный канал', 400);
  const channel = await db().prepare(`SELECT ch.id, ch.url, pf.name AS platformName FROM creator_channels ch
    JOIN platforms pf ON pf.id = ch.platform_id WHERE ch.id = ? AND ch.creator_id = ? AND ch.deleted_at IS NULL`)
    .bind(id, owner.id).first<{ id: number; url: string; platformName: string }>();
  if (!channel) throw new TelegramStorageError('Канал не найден', 404);
  return { channel, owner, identity };
}
export async function createConnectTicket(input: Input) {
  const { channel, owner, identity } = await ownedChannel(input);
  if (channel.platformName === 'RuTube') throw new TelegramStorageError('Для RuTube API-ключ не нужен.', 400);
  await key(); const origin = publicOrigin();
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await hash(token);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await db().batch([
    db().prepare('DELETE FROM social_connect_tickets WHERE channel_id = ? OR expires_at < ?').bind(channel.id, new Date().toISOString()),
    db().prepare('INSERT INTO social_connect_tickets(token_hash,channel_id,creator_id,telegram_user_id,expires_at,consumed) VALUES(?,?,?,?,?,0)').bind(tokenHash, channel.id, owner.id, identity.id, expiresAt),
  ]);
  return { url: `${origin}/connect/${token}`, expiresAt, platformName: channel.platformName };
}
export async function connectTicket(token: string, consumed = 0): Promise<Ticket> {
  const tokenHash = await hash(token);
  return connectTicketHash(tokenHash, consumed);
}
export async function connectTicketHash(tokenHash: string, consumed = 0): Promise<Ticket> {
  const row = await db().prepare(`SELECT t.token_hash AS tokenHash, t.channel_id AS channelId, t.creator_id AS creatorId,
    t.telegram_user_id AS telegramUserId, t.expires_at AS expiresAt, t.consumed, ch.url,
    ch.provider_channel_id AS providerChannelId, pf.name AS platformName
    FROM social_connect_tickets t JOIN creator_channels ch ON ch.id = t.channel_id AND ch.creator_id = t.creator_id
    JOIN creators c ON c.id = ch.creator_id JOIN producers p ON p.id = c.producer_id
    JOIN platforms pf ON pf.id = ch.platform_id
    JOIN telegram_creator_links l ON l.creator_id = c.id AND l.telegram_user_id = t.telegram_user_id
    JOIN telegram_accounts a ON a.telegram_user_id = t.telegram_user_id
    WHERE t.token_hash = ? AND t.consumed = ? AND t.expires_at > ? AND ch.deleted_at IS NULL
      AND c.status = 'active' AND p.status = 'active' AND pf.status = 'active' AND a.role = 'creator' AND l.type_confirmed_at IS NOT NULL`)
    .bind(tokenHash, consumed, new Date().toISOString()).first<Ticket>();
  if (!row) throw new TelegramStorageError('Ссылка истекла или уже использована. Получите новую через /channels в боте.', 410);
  return row;
}
export async function saveConnectTicket(token: string, input: Input) {
  const ticket = await connectTicket(token);
  let credentials = parseCredentials(input);
  if (ticket.platformName === 'TikTok' && (!credentials.refreshToken || !Reflect.get(env, 'TIKTOK_CLIENT_KEY') || !Reflect.get(env, 'TIKTOK_CLIENT_SECRET'))) {
    throw new TelegramStorageError('Для ежедневного обновления TikTok нужны refresh token и настройки одобренного приложения на сервере. Администратору: TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET. Канал и прежний доступ сохранены.', 409);
  }
  if (ticket.platformName === 'VK' && (!credentials.refreshToken || !credentials.clientId || !credentials.deviceId)) {
    throw new TelegramStorageError('Для ежедневного VK нужны refresh_token, client_id и device_id из VK ID. Одного часового access token недостаточно. Прежний доступ сохранён.', 400);
  }
  const claim = await db().prepare('UPDATE social_connect_tickets SET consumed = 1 WHERE token_hash = ? AND consumed = 0').bind(ticket.tokenHash).run();
  if (claim.meta.changes !== 1) throw new TelegramStorageError('Ссылка уже использована', 410);
  const identity = await inspectAccess(ticket, credentials);
  if (!identity.accountId) throw new SocialApiError('API не подтвердил владельца.');
  let expiresAt: string | null = null;
  let refreshedAt: string | null = null;
  try {
    const refreshed = await refreshAccess(ticket.platformName, credentials, { expectedAccountId: identity.accountId,
      tiktokClientKey: Reflect.get(env, 'TIKTOK_CLIENT_KEY'), tiktokClientSecret: Reflect.get(env, 'TIKTOK_CLIENT_SECRET'),
      vkServiceToken: Reflect.get(env, 'VK_SERVICE_TOKEN'), vkClientId: Reflect.get(env, 'VK_CLIENT_ID') });
    if (refreshed) { credentials = refreshed.credentials; expiresAt = refreshed.expiresAt; refreshedAt = new Date().toISOString(); }
  } catch (error) {
    if (['Instagram', 'Threads'].includes(ticket.platformName) && error instanceof SocialApiError && error.syncStatus === 'needs_auth') {
      throw new TelegramStorageError(`${ticket.platformName} не подтвердил продление токена. Используйте «Войти через ${ticket.platformName}» либо действующий long-lived токен старше суток. Прежний доступ сохранён.`, 400);
    }
    throw error;
  }
  // Probe video permissions too; profile access alone is not enough for metrics.
  await verifyReadAccess(ticket, credentials);
  return persistConnectedTicket(ticket.tokenHash, credentials, identity, expiresAt, refreshedAt);
}
export async function persistConnectedTicket(tokenHash: string, credentials: ReturnType<typeof parseCredentials>, identity: { accountId: string; username?: string }, expiresAt: string | null, refreshedAt: string | null, oauthStateHash?: string) {
  const ticket = await connectTicketHash(tokenHash, 1);
  const now = new Date().toISOString();
  const cipher = await encrypt(credentials, ticket.creatorId, ticket.channelId, identity.accountId);
  const results = await db().batch([
    db().prepare(`INSERT INTO social_connections(channel_id,creator_id,telegram_user_id,account_id,username,ciphertext,status,expires_at,refreshed_at,updated_at)
      SELECT ch.id,t.creator_id,t.telegram_user_id,?,?,?,'connected',?,?,? FROM social_connect_tickets t
      JOIN creator_channels ch ON ch.id=t.channel_id AND ch.creator_id=t.creator_id
      JOIN creators c ON c.id=ch.creator_id JOIN producers p ON p.id=c.producer_id
      JOIN platforms pf ON pf.id=ch.platform_id
      JOIN telegram_accounts a ON a.telegram_user_id=t.telegram_user_id
      JOIN telegram_creator_links l ON l.telegram_user_id=a.telegram_user_id AND l.creator_id=c.id
      WHERE t.token_hash=? AND t.consumed=1 AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ch.deleted_at IS NULL
        AND c.status='active' AND p.status='active' AND pf.status='active' AND a.role='creator' AND l.type_confirmed_at IS NOT NULL
        AND (? IS NULL OR EXISTS(SELECT 1 FROM social_oauth_sessions os WHERE os.state_hash=? AND os.ticket_hash=t.token_hash
          AND os.status='exchanging' AND os.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
      ON CONFLICT(channel_id) DO UPDATE SET creator_id=excluded.creator_id,telegram_user_id=excluded.telegram_user_id,
      account_id=excluded.account_id,username=excluded.username,ciphertext=excluded.ciphertext,status='connected',expires_at=excluded.expires_at,refreshed_at=excluded.refreshed_at,updated_at=excluded.updated_at`)
      .bind(identity.accountId, identity.username || identity.accountId, cipher, expiresAt, refreshedAt, now, ticket.tokenHash, oauthStateHash || null, oauthStateHash || null),
    db().prepare(`UPDATE creator_channels SET sync_status='pending',sync_error=NULL,next_sync_at=?,lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE id=? AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM social_connections WHERE channel_id=? AND updated_at=?)`)
      .bind(now, now, ticket.channelId, ticket.channelId, now),
    ...(oauthStateHash ? [db().prepare(`UPDATE social_oauth_sessions SET status='complete',ciphertext='',message='Доступ подключён. Первая проверка поставлена в очередь, затем обновляем ежедневно.'
      WHERE state_hash=? AND status='exchanging' AND EXISTS(SELECT 1 FROM social_connections WHERE channel_id=? AND updated_at=?)`).bind(oauthStateHash, ticket.channelId, now)] : []),
  ]);
  if (results[0].meta.changes !== 1 || (oauthStateHash && results[2].meta.changes !== 1)) throw new TelegramStorageError('Канал или попытка подключения изменены. Получите новую ссылку.', 409);
  return { platformName: ticket.platformName, username: identity.username };
}
export async function disconnectSocial(input: Input) {
  const { channel } = await ownedChannel(input);
  const now = new Date().toISOString();
  await db().batch([
    db().prepare('DELETE FROM social_connections WHERE channel_id=?').bind(channel.id),
    db().prepare('DELETE FROM social_connect_tickets WHERE channel_id=?').bind(channel.id),
    db().prepare('UPDATE creator_channels SET next_sync_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?').bind(now, now, channel.id),
  ]);
  return { id: channel.id };
}
async function leasedChannel(input: Input) {
  const channel = await db().prepare(`SELECT ch.id FROM creator_channels ch JOIN creators c ON c.id=ch.creator_id
    JOIN producers p ON p.id=c.producer_id JOIN platforms pf ON pf.id=ch.platform_id
    LEFT JOIN social_connections sc ON sc.channel_id=ch.id
    WHERE ch.id=? AND ch.deleted_at IS NULL AND ch.status='active' AND ch.lease_token=? AND ch.lease_until>?
      AND c.status='active' AND p.status='active' AND pf.status='active' AND (sc.channel_id IS NULL OR sc.creator_id=ch.creator_id)`)
    .bind(Number(input.channelId), String(input.leaseToken), new Date().toISOString()).first();
  if (!channel) throw new TelegramStorageError('Задание уже не принадлежит сборщику', 409);
}
const leaseGuard = `EXISTS(SELECT 1 FROM creator_channels ch JOIN creators c ON c.id=ch.creator_id
  JOIN producers p ON p.id=c.producer_id JOIN platforms pf ON pf.id=ch.platform_id
  WHERE ch.id=social_connections.channel_id AND ch.creator_id=social_connections.creator_id AND ch.deleted_at IS NULL
    AND ch.status='active' AND c.status='active' AND p.status='active' AND pf.status='active' AND ch.lease_token=? AND ch.lease_until>?)`;
export async function collectorConnection(input: Input) {
  await leasedChannel(input);
  const row = await db().prepare(`SELECT channel_id AS channelId,creator_id AS creatorId,account_id AS accountId,ciphertext,
    updated_at AS updatedAt,expires_at AS expiresAt,refreshed_at AS refreshedAt,status FROM social_connections WHERE channel_id=?`).bind(Number(input.channelId)).first<Connection>();
  if (!row) return null;
  const credentials = await decrypt(row);
  const stillCurrent = await db().prepare(`SELECT channel_id FROM social_connections WHERE channel_id=? AND updated_at=? AND ${leaseGuard}`).bind(row.channelId, row.updatedAt, String(input.leaseToken), new Date().toISOString()).first();
  if (!stillCurrent) throw new TelegramStorageError('Доступ уже изменён владельцем', 409);
  return { accountId: row.accountId, credentials, version: row.updatedAt, expiresAt: row.expiresAt, refreshedAt: row.refreshedAt, status: row.status };
}
export async function updateCollectorConnection(input: Input) {
  await leasedChannel(input);
  const row = await db().prepare(`SELECT channel_id AS channelId,creator_id AS creatorId,account_id AS accountId,ciphertext,updated_at AS updatedAt
    FROM social_connections WHERE channel_id=? AND updated_at=?`).bind(Number(input.channelId), String(input.version)).first<Connection>();
  if (!row) {
    // Retry after a lost ACK must not repeat refresh or discard an already stored pair.
    const current = await db().prepare(`SELECT channel_id AS channelId,creator_id AS creatorId,account_id AS accountId,ciphertext,updated_at AS updatedAt,status,expires_at AS expiresAt
      FROM social_connections WHERE channel_id=? AND ${leaseGuard}`).bind(Number(input.channelId), String(input.leaseToken), new Date().toISOString()).first<Connection>();
    if (current && input.status === 'needs_auth' && current.status === 'needs_auth') return { version: current.updatedAt };
    if (current && input.credentials && typeof input.credentials === 'object' && current.status === 'connected' && input.expiresAt === current.expiresAt) {
      const repeated = parseCredentials(input.credentials);
      if (JSON.stringify(repeated) === JSON.stringify(await decrypt(current))) {
        await leasedChannel(input);
        return { version: current.updatedAt };
      }
    }
    throw new TelegramStorageError('Доступ уже изменён владельцем', 409);
  }
  // Two refresh writes in one millisecond must still have distinct CAS versions.
  const now = new Date(Math.max(Date.now(), Date.parse(row.updatedAt) + 1)).toISOString();
  if (input.status === 'needs_auth') {
    const result = await db().prepare(`UPDATE social_connections SET status='needs_auth',updated_at=? WHERE channel_id=? AND updated_at=? AND ${leaseGuard}`).bind(now, row.channelId, row.updatedAt, String(input.leaseToken), now).run();
    if (result.meta.changes !== 1) throw new TelegramStorageError('Доступ уже изменён владельцем', 409);
    return { version: now };
  }
  if (!input.credentials || typeof input.credentials !== 'object') throw new TelegramStorageError('Некорректные данные доступа', 400);
  const credentials = parseCredentials(input.credentials);
  if (typeof input.expiresAt !== 'string' || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now()) throw new TelegramStorageError('Некорректный срок доступа', 400);
  const cipher = await encrypt(credentials, row.creatorId, row.channelId, row.accountId);
  const result = await db().prepare(`UPDATE social_connections SET ciphertext=?,expires_at=?,refreshed_at=?,status='connected',updated_at=? WHERE channel_id=? AND updated_at=? AND ${leaseGuard}`)
    .bind(cipher, input.expiresAt, now, now, row.channelId, row.updatedAt, String(input.leaseToken), new Date().toISOString()).run();
  if (result.meta.changes !== 1) throw new TelegramStorageError('Доступ уже изменён владельцем', 409);
  return { version: now };
}
