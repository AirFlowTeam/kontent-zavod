import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/db/storage';

export class TelegramStorageError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'TelegramStorageError';
  }
}

type Input = Record<string, unknown>;
type Account = {
  telegramUserId: string; chatId: string; username: string | null; displayName: string | null;
  role: 'producer' | 'creator' | null; selectedType: 'AI' | 'UGC' | null; pendingInviteHash: string | null;
};
type Invite = { tokenHash: string; producerId: number; producerName: string; creatorId: number | null;
  expiresAt: string; redeemedBy: string | null; producerStatus: string };

function db() {
  if (!env.DB) throw new TelegramStorageError('База данных временно недоступна', 503);
  return env.DB;
}

export function telegramIdentity(input: Input) {
  const id = typeof input.telegramUserId === 'string' || typeof input.telegramUserId === 'number' ? String(input.telegramUserId) : '';
  if (!/^[1-9]\d{0,15}$/.test(id) || BigInt(id) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TelegramStorageError('Некорректный Telegram ID', 400);
  }
  if (input.chatId !== undefined && ((typeof input.chatId !== 'string' && typeof input.chatId !== 'number') || String(input.chatId) !== id)) {
    throw new TelegramStorageError('Бот работает только в личном чате', 400);
  }
  const username = typeof input.username === 'string' ? input.username.replace(/^@/, '').trim() : null;
  if (username && !/^[A-Za-z0-9_]{1,32}$/.test(username)) throw new TelegramStorageError('Некорректный Telegram username', 400);
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim().slice(0, 160) : null;
  return { id, username: username || null, displayName: displayName || null };
}

async function accountFor(input: Input, refresh = true): Promise<Account> {
  await ensureDatabase();
  const identity = telegramIdentity(input);
  const now = new Date().toISOString();
  await db().prepare(`INSERT INTO telegram_accounts (telegram_user_id, chat_id, username, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(telegram_user_id) DO NOTHING`)
    .bind(identity.id, identity.id, identity.username, identity.displayName, now, now).run();
  if (refresh && ('username' in input || 'displayName' in input)) {
    await db().batch([
      db().prepare('UPDATE telegram_accounts SET username = ?, display_name = ?, updated_at = ? WHERE telegram_user_id = ?')
        .bind(identity.username, identity.displayName, now, identity.id),
      db().prepare('UPDATE telegram_creator_links SET username = ?, display_name = ?, updated_at = ? WHERE telegram_user_id = ?')
        .bind(identity.username, identity.displayName, now, identity.id),
    ]);
  }
  return (await db().prepare(`SELECT telegram_user_id AS telegramUserId, chat_id AS chatId,
    username, display_name AS displayName, role, selected_type AS selectedType,
    pending_invite_hash AS pendingInviteHash FROM telegram_accounts WHERE telegram_user_id = ?`)
    .bind(identity.id).first<Account>())!;
}

async function producerFor(userId: string) {
  return db().prepare(`SELECT p.id, p.name, p.status FROM telegram_producer_links l
    JOIN producers p ON p.id = l.producer_id WHERE l.telegram_user_id = ?`)
    .bind(userId).first<{ id: number; name: string; status: string }>();
}

async function creatorFor(userId: string) {
  return db().prepare(`SELECT c.id, c.name, c.type, c.status AS creatorStatus, c.producer_id AS producerId,
    p.name AS producerName, p.status AS producerStatus, t.type_confirmed_at AS typeConfirmedAt,
    pl.telegram_user_id AS producerTelegramId, pa.username AS producerTelegramUsername
    FROM telegram_creator_links t JOIN creators c ON c.id = t.creator_id
    JOIN producers p ON p.id = c.producer_id
    LEFT JOIN telegram_producer_links pl ON pl.producer_id = p.id
    LEFT JOIN telegram_accounts pa ON pa.telegram_user_id = pl.telegram_user_id
    WHERE t.telegram_user_id = ?`).bind(userId).first<{
      id: number; name: string; type: 'AI' | 'UGC'; creatorStatus: string; producerId: number;
      producerName: string; producerStatus: string; typeConfirmedAt: string | null;
      producerTelegramId: string | null; producerTelegramUsername: string | null;
    }>();
}

async function hashToken(token: unknown) {
  if (typeof token !== 'string' || !/^[a-f0-9]{32,64}$/.test(token)) throw new TelegramStorageError('Некорректное приглашение', 400);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function findInvite(hash: string) {
  return db().prepare(`SELECT i.token_hash AS tokenHash, i.producer_id AS producerId, i.creator_id AS creatorId,
    i.expires_at AS expiresAt, i.redeemed_by AS redeemedBy, p.name AS producerName, p.status AS producerStatus
    FROM telegram_invites i JOIN producers p ON p.id = i.producer_id WHERE i.token_hash = ?`)
    .bind(hash).first<Invite>();
}

function validInvite(invite: Invite | null, userId: string): asserts invite is Invite {
  if (!invite) throw new TelegramStorageError('Приглашение не найдено', 404);
  if (invite.redeemedBy && invite.redeemedBy !== userId) throw new TelegramStorageError('Приглашение уже использовано', 409);
  if (!invite.redeemedBy && invite.expiresAt <= new Date().toISOString()) throw new TelegramStorageError('Приглашение истекло. Попросите продюсера новое', 410);
  if (invite.producerStatus !== 'active') throw new TelegramStorageError('Продюсер отключён', 409);
}

export async function getTelegramContext(input: Input) {
  const account = await accountFor(input);
  const [producer, binding] = await Promise.all([producerFor(account.telegramUserId), creatorFor(account.telegramUserId)]);
  const pending = account.pendingInviteHash ? await findInvite(account.pendingInviteHash) : null;
  const role = account.role ?? (binding ? 'creator' : null);
  const creators = producer?.status === 'active'
    ? (await db().prepare(`SELECT c.id, c.name, c.type, c.status,
      t.telegram_user_id AS telegramUserId, t.username AS telegramUsername,
      (SELECT COUNT(*) FROM creator_channels ch WHERE ch.creator_id = c.id AND ch.status = 'active') AS channelCount
      FROM creators c LEFT JOIN telegram_creator_links t ON t.creator_id = c.id
      WHERE c.producer_id = ? ORDER BY c.name, c.id LIMIT 100`).bind(producer.id).all()).results
    : [];
  return { role, selectedType: account.selectedType, producer, binding, creators,
    pendingInvite: pending ? { producerName: pending.producerName, expiresAt: pending.expiresAt,
      status: pending.redeemedBy && pending.redeemedBy !== account.telegramUserId ? 'used'
        : pending.expiresAt <= new Date().toISOString() && !pending.redeemedBy ? 'expired'
          : pending.producerStatus !== 'active' ? 'inactive' : 'valid' } : null,
    canSubmit: role === 'creator' && Boolean(binding?.typeConfirmedAt && binding.producerTelegramId
      && binding.creatorStatus === 'active' && binding.producerStatus === 'active') };
}

export async function selectTelegramRole(input: Input) {
  const account = await accountFor(input);
  if (input.role !== 'creator' && input.role !== 'producer') throw new TelegramStorageError('Выберите роль', 400);
  // Choosing a producer role creates only a NEW isolated team; it never claims an existing name/team.
  if (input.role === 'producer') {
    const existing = await producerFor(account.telegramUserId);
    if (!existing) {
      const now = new Date().toISOString();
      const name = `${(account.displayName || account.username || 'Продюсер').slice(0, 50)} · TG ${account.telegramUserId}`;
      await db().batch([
        db().prepare(`INSERT INTO producers(name, status, created_at) SELECT ?, 'active', ?
          WHERE NOT EXISTS (SELECT 1 FROM telegram_producer_links WHERE telegram_user_id = ?)`)
          .bind(name, now, account.telegramUserId),
        db().prepare(`INSERT INTO telegram_producer_links(telegram_user_id, producer_id, created_at)
          SELECT ?, id, ? FROM producers WHERE name = ? ON CONFLICT(telegram_user_id) DO NOTHING`)
          .bind(account.telegramUserId, now, name),
      ]);
    } else if (existing.status !== 'active') throw new TelegramStorageError('Продюсер отключён', 409);
  }
  await db().prepare('UPDATE telegram_accounts SET role = ?, updated_at = ? WHERE telegram_user_id = ?')
    .bind(input.role, new Date().toISOString(), account.telegramUserId).run();
  return getTelegramContext(input);
}

export async function createTelegramInvite(input: Input) {
  const account = await accountFor(input);
  const producer = await producerFor(account.telegramUserId);
  if (account.role !== 'producer' || producer?.status !== 'active') throw new TelegramStorageError('Доступно только вашему продюсерскому аккаунту', 403);
  const updateId = Number(input.updateId);
  if (!Number.isSafeInteger(updateId) || updateId < 0) throw new TelegramStorageError('Некорректный updateId', 400);
  const creatorId = input.creatorId === undefined ? null : Number(input.creatorId);
  const priorRequest = await db().prepare('SELECT token_hash FROM telegram_invites WHERE created_by = ? AND update_id = ?')
    .bind(account.telegramUserId, updateId).first();
  if (creatorId !== null && !priorRequest) {
    if (!Number.isSafeInteger(creatorId) || creatorId <= 0) throw new TelegramStorageError('Некорректный креатор', 400);
    const existing = await db().prepare(`SELECT id FROM creators WHERE id = ? AND producer_id = ? AND status = 'active'
      AND NOT EXISTS (SELECT 1 FROM telegram_creator_links WHERE creator_id = creators.id)`)
      .bind(creatorId, producer.id).first();
    if (!existing) throw new TelegramStorageError('Можно пригласить только своего непривязанного креатора', 403);
  }
  // HMAC gives idempotent invitation delivery after a lost Telegram reply, without storing bearer tokens.
  const secret = Reflect.get(env, 'SYNC_SECRET');
  if (typeof secret !== 'string' || !secret) throw new TelegramStorageError('Сервис приглашений не настроен', 503);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`creator-invite:${account.telegramUserId}:${updateId}`));
  const token = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 48);
  const tokenHash = await hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 86400_000).toISOString();
  await db().prepare(`INSERT INTO telegram_invites(token_hash, producer_id, creator_id, created_by, update_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(created_by, update_id) DO NOTHING`)
    .bind(tokenHash, producer.id, creatorId, account.telegramUserId, updateId, expiresAt, now.toISOString()).run();
  const invite = await findInvite(tokenHash);
  if (!invite || invite.creatorId !== creatorId || invite.producerId !== producer.id) throw new TelegramStorageError('Обновление уже обработано с другими параметрами', 409);
  return { token, expiresAt: invite.expiresAt, producerName: producer.name };
}

export async function acceptTelegramInvite(input: Input) {
  const account = await accountFor(input);
  const hash = await hashToken(input.token);
  const invite = await findInvite(hash);
  validInvite(invite, account.telegramUserId);
  const ownProducer = await producerFor(account.telegramUserId);
  if (ownProducer?.id === invite.producerId) return { ...await getTelegramContext(input), ownInvite: true };
  const linked = await creatorFor(account.telegramUserId);
  if (linked && (linked.producerId !== invite.producerId || (invite.creatorId && invite.creatorId !== linked.id))) {
    throw new TelegramStorageError('Вы уже привязаны к другому креатору или продюсеру. Перенос выполняется администратором', 409);
  }
  await db().prepare(`UPDATE telegram_accounts SET role = 'creator', pending_invite_hash = ?, updated_at = ? WHERE telegram_user_id = ?`)
    .bind(hash, new Date().toISOString(), account.telegramUserId).run();
  if (account.selectedType) return finishCreator({ ...account, pendingInviteHash: hash, role: 'creator' });
  return getTelegramContext(input);
}

export async function selectTelegramCreatorType(input: Input) {
  const account = await accountFor(input);
  const linked = await creatorFor(account.telegramUserId);
  if (account.role !== 'creator' && !(account.role === null && linked)) throw new TelegramStorageError('Сначала выберите роль креатора', 409);
  if (!linked) {
    if (!account.pendingInviteHash) throw new TelegramStorageError('Сначала откройте приглашение от продюсера', 409);
    validInvite(await findInvite(account.pendingInviteHash), account.telegramUserId);
  }
  if (input.type !== 'AI' && input.type !== 'UGC') throw new TelegramStorageError('Выберите ИИ-контент или UGC', 400);
  if (account.selectedType && account.selectedType !== input.type) throw new TelegramStorageError('Тип уже выбран. Изменить его можно через администратора', 409);
  if (linked?.typeConfirmedAt && linked.type !== input.type) throw new TelegramStorageError('Тип этого креатора уже подтверждён. Обратитесь к администратору', 409);
  await db().prepare(`UPDATE telegram_accounts SET role = 'creator', selected_type = ?, updated_at = ?
    WHERE telegram_user_id = ? AND (selected_type IS NULL OR selected_type = ?)`)
    .bind(input.type, new Date().toISOString(), account.telegramUserId, input.type).run();
  const selected = await accountFor({ telegramUserId: account.telegramUserId }, false);
  if (selected.selectedType !== input.type) throw new TelegramStorageError('Тип уже выбран. Изменить его можно через администратора', 409);
  return finishCreator({ ...account, role: 'creator', selectedType: input.type });
}

async function finishCreator(account: Account) {
  const linked = await creatorFor(account.telegramUserId);
  const now = new Date().toISOString();
  if (linked) {
    if (account.pendingInviteHash) {
      const pending = await findInvite(account.pendingInviteHash);
      validInvite(pending, account.telegramUserId);
      if (pending.producerId !== linked.producerId || (pending.creatorId && pending.creatorId !== linked.id)) {
        throw new TelegramStorageError('Приглашение относится к другому профилю', 409);
      }
      await db().prepare(`UPDATE telegram_invites SET redeemed_by = ?, redeemed_at = ?
        WHERE token_hash = ? AND (redeemed_by IS NULL OR redeemed_by = ?)`)
        .bind(account.telegramUserId, now, pending.tokenHash, account.telegramUserId).run();
      const redeemed = await findInvite(pending.tokenHash);
      if (redeemed?.redeemedBy !== account.telegramUserId) throw new TelegramStorageError('Приглашение уже использовано', 409);
    }
    if (linked.creatorStatus !== 'active' || linked.producerStatus !== 'active') throw new TelegramStorageError('Профиль отключён', 409);
    if (linked.typeConfirmedAt && linked.type !== account.selectedType) throw new TelegramStorageError('Тип подтверждён. Обратитесь к администратору', 409);
    await db().batch([
      db().prepare(`UPDATE creators SET type = ? WHERE id = ? AND NOT EXISTS
        (SELECT 1 FROM telegram_creator_links WHERE creator_id = ? AND type_confirmed_at IS NOT NULL)`)
        .bind(account.selectedType, linked.id, linked.id),
      db().prepare(`UPDATE telegram_creator_links SET type_confirmed_at = COALESCE(type_confirmed_at, ?), updated_at = ?
        WHERE telegram_user_id = ? AND EXISTS (SELECT 1 FROM creators WHERE id = creator_id AND type = ?)`)
        .bind(now, now, account.telegramUserId, account.selectedType),
      db().prepare('UPDATE telegram_accounts SET pending_invite_hash = NULL WHERE telegram_user_id = ?').bind(account.telegramUserId),
    ]);
    const confirmed = await creatorFor(account.telegramUserId);
    if (!confirmed?.typeConfirmedAt || confirmed.type !== account.selectedType) {
      throw new TelegramStorageError('Тип этого креатора уже подтверждён. Обратитесь к администратору', 409);
    }
    return getTelegramContext({ telegramUserId: account.telegramUserId });
  }
  if (!account.pendingInviteHash) return getTelegramContext({ telegramUserId: account.telegramUserId });
  const invite = await findInvite(account.pendingInviteHash);
  validInvite(invite, account.telegramUserId);
  const name = `${(account.displayName || account.username || 'Креатор').slice(0, 50)} · TG ${account.telegramUserId}`;
  const operations: D1PreparedStatement[] = [db().prepare(`UPDATE telegram_invites SET redeemed_by = ?, redeemed_at = ?
    WHERE token_hash = ? AND (redeemed_by IS NULL OR redeemed_by = ?) AND expires_at > ?
    AND (creator_id IS NULL OR EXISTS (SELECT 1 FROM creators c WHERE c.id = telegram_invites.creator_id
      AND c.status = 'active' AND c.producer_id = telegram_invites.producer_id
      AND NOT EXISTS (SELECT 1 FROM telegram_creator_links l WHERE l.creator_id = c.id)))`)
    .bind(account.telegramUserId, now, invite.tokenHash, account.telegramUserId, now)];
  if (!invite.creatorId) {
    operations.push(db().prepare(`INSERT INTO creators(name, type, producer_id, status, created_at)
      SELECT ?, ?, producer_id, 'active', ? FROM telegram_invites
      WHERE token_hash = ? AND redeemed_by = ?
      AND NOT EXISTS (SELECT 1 FROM telegram_creator_links WHERE telegram_user_id = ?)`)
      .bind(name, account.selectedType, now, invite.tokenHash, account.telegramUserId, account.telegramUserId));
  }
  const creatorSelection = invite.creatorId ? 'c.id = ?' : 'c.name = ?';
  operations.push(db().prepare(`INSERT INTO telegram_creator_links
    (telegram_user_id, creator_id, chat_id, username, display_name, type_confirmed_at, created_at, updated_at)
    SELECT ?, c.id, ?, ?, ?, ?, ?, ? FROM creators c JOIN telegram_invites i ON i.producer_id = c.producer_id
    WHERE i.token_hash = ? AND i.redeemed_by = ? AND ${creatorSelection} AND c.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM telegram_creator_links WHERE creator_id = c.id)
    ON CONFLICT(telegram_user_id) DO NOTHING`)
    .bind(account.telegramUserId, account.telegramUserId, account.username, account.displayName, now, now, now,
      invite.tokenHash, account.telegramUserId, invite.creatorId ?? name));
  operations.push(db().prepare(`UPDATE creators SET type = ? WHERE id IN
    (SELECT creator_id FROM telegram_creator_links WHERE telegram_user_id = ? AND type_confirmed_at = ?)`)
    .bind(account.selectedType, account.telegramUserId, now));
  operations.push(db().prepare(`UPDATE telegram_accounts SET pending_invite_hash = NULL WHERE telegram_user_id = ?
    AND EXISTS(SELECT 1 FROM telegram_creator_links WHERE telegram_user_id = ?)`)
    .bind(account.telegramUserId, account.telegramUserId));
  await db().batch(operations);
  if (!(await creatorFor(account.telegramUserId))) throw new TelegramStorageError('Приглашение уже принято или профиль занят. Попросите новое приглашение', 409);
  return getTelegramContext({ telegramUserId: account.telegramUserId });
}

export async function requireTelegramCreatorReady(userId: string) {
  const context = await getTelegramContext({ telegramUserId: userId });
  if (!context.canSubmit) throw new TelegramStorageError(
    !context.binding?.typeConfirmedAt ? 'Перед добавлением канала выберите ИИ-контент или UGC и примите приглашение продюсера'
      : 'Нужна Telegram-привязка активного продюсера. Попросите администратора проверить профиль', 409);
  return context.binding!;
}

export async function listTelegramChannels(input: Input) {
  const context = await getTelegramContext(input);
  const identity = telegramIdentity(input);
  const producerMode = context.role === 'producer' && context.producer?.status === 'active';
  if (!producerMode && !context.canSubmit) throw new TelegramStorageError('Завершите регистрацию через /start', 409);
  return (await db().prepare(`SELECT ch.id, ch.normalized_url AS url, ch.title, pf.name AS platformName,
    c.name AS creatorName, c.type AS creatorType, p.name AS producerName,
    t.telegram_user_id AS creatorTelegramId, t.username AS creatorTelegramUsername,
    pl.telegram_user_id AS producerTelegramId, a.username AS producerTelegramUsername,
    COALESCE(ch.followers_override, ch.followers) AS followers,
    COALESCE(ch.total_views_override, ch.total_views) AS totalViews,
    COALESCE(ch.total_likes_override, ch.total_likes) AS totalLikes,
    COALESCE(ch.publication_count_override, ch.publication_count) AS publicationCount,
    ch.sync_status AS syncStatus, ch.sync_error AS syncError, ch.metrics_updated_at AS metricsUpdatedAt,
    ch.next_sync_at AS nextSyncAt FROM creator_channels ch
    JOIN creators c ON c.id = ch.creator_id JOIN producers p ON p.id = c.producer_id
    JOIN platforms pf ON pf.id = ch.platform_id
    LEFT JOIN telegram_creator_links t ON t.creator_id = c.id
    LEFT JOIN telegram_producer_links pl ON pl.producer_id = p.id
    LEFT JOIN telegram_accounts a ON a.telegram_user_id = pl.telegram_user_id
    WHERE ${producerMode ? 'c.producer_id = ?' : 't.telegram_user_id = ?'} AND ch.status = 'active'
    ORDER BY c.id, ch.id LIMIT 50`).bind(producerMode ? context.producer!.id : identity.id).all()).results;
}
