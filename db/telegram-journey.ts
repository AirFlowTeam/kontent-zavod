import { env } from 'cloudflare:workers';
import { requireTelegramCreatorReady, telegramIdentity, TelegramStorageError } from '@/db/telegram-onboarding';
import { socialReadiness } from '@/lib/server/social-readiness';
import { isTelegramAdmin } from '@/lib/server/telegram-admin';

type Input = Record<string, unknown>;
const platforms = ['YouTube', 'RuTube', 'VK', 'TikTok', 'Instagram', 'Threads'];
// Every write rechecks ownership and active profiles in the same statement.
const ownerGuard = `EXISTS(SELECT 1 FROM telegram_creator_links l
  JOIN telegram_accounts a ON a.telegram_user_id=l.telegram_user_id
  JOIN creators c ON c.id=l.creator_id JOIN producers p ON p.id=c.producer_id
  JOIN telegram_producer_links pl ON pl.producer_id=p.id
  WHERE l.telegram_user_id=? AND c.id=? AND (a.role IN ('creator','producer') OR ?=1)
    AND l.type_confirmed_at IS NOT NULL AND c.status='active' AND p.status='active')`;

export async function getTelegramJourney(input: Input) {
  const owner = await requireTelegramCreatorReady(telegramIdentity(input).id);
  const rows = await env.DB.prepare('SELECT platform_name AS platformName FROM telegram_journey_platforms WHERE creator_id=?')
    .bind(owner.id).all<{ platformName: string }>();
  return { journey: { skippedPlatforms: rows.results.map((row) => row.platformName) }, setup: socialReadiness() };
}

export async function setTelegramJourneyPlatform(input: Input) {
  const identity = telegramIdentity(input);
  const owner = await requireTelegramCreatorReady(identity.id);
  if (typeof input.platformName !== 'string' || !platforms.includes(input.platformName) || !['skipped', 'needed'].includes(String(input.status))) {
    throw new TelegramStorageError('Выберите площадку и действие заново через /guide', 400);
  }
  const args = [identity.id, owner.id, Number(isTelegramAdmin(identity.id))];
  if (input.status === 'needed') {
    await env.DB.prepare(`DELETE FROM telegram_journey_platforms WHERE creator_id=? AND platform_name=? AND ${ownerGuard}`)
      .bind(owner.id, input.platformName, ...args).run();
  } else {
    // Existing channels always win: skipping cannot hide a broken connection.
    const result = await env.DB.prepare(`INSERT INTO telegram_journey_platforms(creator_id,platform_name,updated_at)
      SELECT ?,?,? WHERE ${ownerGuard} AND NOT EXISTS(SELECT 1 FROM creator_channels ch
        JOIN platforms pf ON pf.id=ch.platform_id WHERE ch.creator_id=? AND pf.name=? AND ch.deleted_at IS NULL)
      ON CONFLICT(creator_id,platform_name) DO UPDATE SET updated_at=excluded.updated_at`)
      .bind(owner.id, input.platformName, new Date().toISOString(), ...args, owner.id, input.platformName).run();
    if (!result.meta.changes) throw new TelegramStorageError('На этой площадке уже есть канал. Проверьте его в /channels; отметка «нет аккаунта» не скрывает добавленные каналы.', 409);
  }
  return getTelegramJourney(input);
}

export async function recheckTelegramChannel(input: Input) {
  const identity = telegramIdentity(input);
  const owner = await requireTelegramCreatorReady(identity.id);
  const id = Number(input.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TelegramStorageError('Некорректный канал', 400);
  const row = await env.DB.prepare(`SELECT ch.status, pf.name AS platformName, pf.status AS platformStatus, ch.lease_until AS leaseUntil,
    EXISTS(SELECT 1 FROM social_connections sc WHERE sc.channel_id=ch.id AND sc.creator_id=ch.creator_id AND sc.status='connected') AS hasPersonalAccess,
    r.requested_at AS requestedAt FROM creator_channels ch JOIN platforms pf ON pf.id=ch.platform_id
    LEFT JOIN telegram_channel_rechecks r ON r.channel_id=ch.id
    WHERE ch.id=? AND ch.creator_id=? AND ch.deleted_at IS NULL`).bind(id, owner.id)
    .first<{ status: string; platformName: string; hasPersonalAccess: number; platformStatus: string; leaseUntil: string | null; requestedAt: string | null }>();
  if (!row) throw new TelegramStorageError('Канал не найден', 404);
  if (row.status !== 'active' || row.platformStatus !== 'active') throw new TelegramStorageError('Сбор приостановлен. Сначала возобновите сбор в карточке канала.', 409);
  if (row.platformName !== 'RuTube' && !row.hasPersonalAccess) return { queued: false, inProgress: false, retryAfterSeconds: 0, needsAccess: true, platformName: row.platformName };
  const now = new Date().toISOString();
  if (row.leaseUntil && row.leaseUntil > now) return { queued: false, inProgress: true, retryAfterSeconds: 0 };
  const remaining = row.requestedAt ? Math.ceil((Date.parse(row.requestedAt) + 60_000 - Date.now()) / 1000) : 0;
  if (remaining > 0) return { queued: false, inProgress: false, retryAfterSeconds: remaining };
  const [receipt, queued] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO telegram_channel_rechecks(channel_id,requested_at)
      SELECT ch.id,? FROM creator_channels ch JOIN platforms pf ON pf.id=ch.platform_id
      WHERE ch.id=? AND ch.creator_id=? AND ch.deleted_at IS NULL AND ch.status='active' AND pf.status='active'
        AND (ch.lease_until IS NULL OR ch.lease_until<=?) AND ${ownerGuard}
        AND (pf.name='RuTube' OR EXISTS(SELECT 1 FROM social_connections sc
          WHERE sc.channel_id=ch.id AND sc.creator_id=ch.creator_id AND sc.status='connected'))
      ON CONFLICT(channel_id) DO UPDATE SET requested_at=excluded.requested_at
        WHERE telegram_channel_rechecks.requested_at<=?`)
      .bind(now, id, owner.id, now, identity.id, owner.id, Number(isTelegramAdmin(identity.id)), new Date(Date.now() - 60_000).toISOString()),
    env.DB.prepare(`UPDATE creator_channels SET next_sync_at=?,sync_status='pending',updated_at=?
      WHERE id=? AND creator_id=? AND deleted_at IS NULL AND status='active' AND changes()=1
        AND (lease_until IS NULL OR lease_until<=?) AND ${ownerGuard}`)
      .bind(now, now, id, owner.id, now, identity.id, owner.id, Number(isTelegramAdmin(identity.id))),
  ]);
  const accepted = receipt.meta.changes === 1 && queued.meta.changes === 1;
  return { queued: accepted, inProgress: false, retryAfterSeconds: accepted ? 60 : 0 };
}
