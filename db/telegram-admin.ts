import { env } from 'cloudflare:workers';
import { getDashboardData, updateChannel, deleteChannel } from '@/db/storage';
import { isTelegramAdmin } from '@/lib/server/telegram-admin';
import { telegramIdentity, TelegramStorageError, getTelegramContext, selectTelegramRole, selectTelegramCreatorType, createTelegramInvite } from '@/db/telegram-onboarding';

type Input = Record<string, unknown>;
export function requireTelegramAdmin(input: Input) {
  const actor = telegramIdentity(input);
  if (!isTelegramAdmin(actor.id)) throw new TelegramStorageError('Доступно только администратору', 403);
  return actor;
}

export async function telegramAdminAction(input: Input) {
  const actor = requireTelegramAdmin(input);
  if (input.action === 'adminManageChannel') {
    if (input.operation === 'delete') return { id: await deleteChannel({ id: input.id }) };
    if (input.operation === 'edit') return { id: await updateChannel({ id: input.id, url: input.url }) };
    if (input.operation === 'pause' || input.operation === 'resume') {
      return { id: await updateChannel({ id: input.id, status: input.operation === 'pause' ? 'inactive' : 'active' }) };
    }
    throw new TelegramStorageError('Неизвестное действие с каналом', 400);
  }
  if (input.action === 'adminInvite') return { invite: await createTelegramInvite(input) };
  if (input.action === 'adminCreator') {
    const context = await getTelegramContext(input);
    if (context.binding) {
      if (!context.producer) await selectTelegramRole({ ...input, role: 'producer' });
      if (!context.binding.typeConfirmedAt && (input.type === 'AI' || input.type === 'UGC')) {
        await selectTelegramRole({ ...input, role: 'creator' });
        return selectTelegramCreatorType(input);
      }
      return getTelegramContext(input);
    }
    if (input.type !== 'AI' && input.type !== 'UGC') throw new TelegramStorageError('Выберите ИИ-контент или UGC', 400);
    const producer = (await selectTelegramRole({ ...input, role: 'producer' })).producer!;
    const now = new Date().toISOString(), name = `${(actor.displayName || actor.username || 'Администратор').slice(0, 45)} · TG ${actor.id}`;
    // Admin may create only their OWN creator profile, without borrowing any
    // other user's identity or bypassing ownership checks for personal API keys.
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO creators(name,type,producer_id,status,created_at)
        SELECT ?,?,?,'active',? WHERE NOT EXISTS(SELECT 1 FROM telegram_creator_links WHERE telegram_user_id=?)`)
        .bind(name, input.type, producer.id, now, actor.id),
      env.DB.prepare(`INSERT INTO telegram_creator_links(telegram_user_id,creator_id,chat_id,username,display_name,type_confirmed_at,created_at,updated_at)
        SELECT ?,last_insert_rowid(),?,?,?,?,?,? WHERE changes()=1 ON CONFLICT(telegram_user_id) DO NOTHING`)
        .bind(actor.id, actor.id, actor.username, actor.displayName, now, now, now),
      env.DB.prepare(`UPDATE telegram_accounts SET role='creator', selected_type=(SELECT c.type FROM creators c JOIN telegram_creator_links l ON l.creator_id=c.id WHERE l.telegram_user_id=?),
        pending_invite_hash=NULL,updated_at=? WHERE telegram_user_id=? AND EXISTS(SELECT 1 FROM telegram_creator_links WHERE telegram_user_id=?)`)
        .bind(actor.id, now, actor.id, actor.id),
    ]);
    return getTelegramContext(input);
  }
  if (input.action !== 'adminRead') throw new TelegramStorageError('Неизвестное действие администратора', 400);
  const data = await getDashboardData();
  const counts = { users: data.telegramAccounts.length, creators: data.creators.length, producers: data.producers.length, channels: data.channels.length };
  if (!input.entity) return { counts };
  const collections: Record<string, unknown[]> = { users: data.telegramAccounts, creators: data.creators, producers: data.producers, channels: data.channels };
  if (typeof input.entity !== 'string' || !Object.hasOwn(collections, input.entity)) throw new TelegramStorageError('Неизвестный список', 400);
  const items = collections[input.entity];
  if (input.id !== undefined) {
    const item = (items as { id: unknown }[]).find((item) => Number(item.id) === Number(input.id));
    if (!item) throw new TelegramStorageError('Запись не найдена', 404);
    return { item };
  }
  const page = input.page ?? 0;
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 0 || page > 100000) throw new TelegramStorageError('Некорректная страница', 400);
  return { counts, items: items.slice(page * 5, page * 5 + 5), page, total: items.length, hasNext: (page + 1) * 5 < items.length };
}
