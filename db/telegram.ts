import { env } from 'cloudflare:workers';

import { ensureDatabase, normalizeChannelUrl } from '@/db/storage';
import { TelegramStorageError, requireTelegramCreatorReady } from '@/db/telegram-onboarding';
export { TelegramStorageError } from '@/db/telegram-onboarding';

type CreatorType = 'UGC' | 'AI';
type SourceKind = 'channel' | 'video';
type SubmissionStatus = 'created' | 'existing';

type CreatorRow = {
  id: number;
  name: string;
  type: CreatorType;
  producerName: string;
};

type BindingRow = CreatorRow & {
  creatorStatus: 'active' | 'inactive';
  producerStatus: 'active' | 'inactive';
};

type ChannelRow = {
  id: number;
  creatorId: number;
  creatorName: string;
  platformName: string;
  normalizedUrl: string;
  status: 'active' | 'inactive';
  deletedAt?: string | null;
  providerChannelId: string | null;
  handle: string | null;
};

type SubmissionRow = ChannelRow & {
  telegramUserId: string;
  submittedCreatorId: number;
  sourceKind: SourceKind;
  resultStatus: SubmissionStatus;
};

function database() {
  if (!env.DB) throw new Error('База данных временно недоступна');
  return env.DB;
}

function record(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TelegramStorageError('Ожидается JSON-объект', 400);
  }
  return value as Record<string, unknown>;
}

function telegramId(value: unknown, label: string, allowNegative = false) {
  const candidate = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const pattern = allowNegative ? /^-?[1-9]\d{0,19}$/ : /^[1-9]\d{0,19}$/;
  if (!pattern.test(candidate)) throw new TelegramStorageError(`Некорректное поле «${label}»`, 400);
  return candidate;
}

function updateId(value: unknown) {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TelegramStorageError('Некорректный ID обновления Telegram', 400);
  }
  return parsed;
}

function optionalText(value: unknown, label: string, maxLength: number) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new TelegramStorageError(`Некорректное поле «${label}»`, 400);
  const result = value.trim();
  if (!result) return null;
  if (result.length > maxLength) throw new TelegramStorageError(`Поле «${label}» слишком длинное`, 400);
  return result;
}

function optionalIdentifier(value: unknown, label: string) {
  const result = optionalText(value, label, 256);
  if (result) {
    for (let index = 0; index < result.length; index += 1) {
      const code = result.charCodeAt(index);
      if (code < 32 || code === 127) {
        throw new TelegramStorageError(`Некорректное поле «${label}»`, 400);
      }
    }
  }
  return result;
}

function sourceKind(value: unknown): SourceKind {
  if (value !== 'channel' && value !== 'video') {
    throw new TelegramStorageError('Тип ссылки должен быть channel или video', 400);
  }
  return value;
}

function publicChannel(row: ChannelRow, submittedCreatorId: number, status: SubmissionStatus, idempotent = false) {
  const creatorMatch = row.creatorId === submittedCreatorId;
  return {
    id: row.id,
    normalizedUrl: row.normalizedUrl,
    platformName: row.platformName,
    status: row.deletedAt ? 'deleted' : row.status,
    creatorId: row.creatorId,
    creatorName: creatorMatch ? row.creatorName : null,
    creatorMatch,
    resultStatus: status,
    idempotent,
  };
}

async function findSubmission(binding: D1Database, id: number) {
  return binding.prepare(`SELECT s.telegram_user_id AS telegramUserId,
    s.creator_id AS submittedCreatorId, s.source_kind AS sourceKind,
    s.result_status AS resultStatus, ch.id, ch.creator_id AS creatorId,
    c.name AS creatorName, pf.name AS platformName,
    ch.url AS normalizedUrl, ch.status, ch.deleted_at AS deletedAt
    FROM telegram_submissions s
    JOIN creator_channels ch ON ch.id = s.channel_id
    JOIN creators c ON c.id = ch.creator_id
    JOIN platforms pf ON pf.id = ch.platform_id
    WHERE s.update_id = ?`).bind(id).first<SubmissionRow>();
}

async function findChannel(
  binding: D1Database,
  normalizedUrl: string,
  platformId?: number,
  providerChannelId?: string | null,
  handle?: string | null,
) {
  const selection = `SELECT ch.id, ch.creator_id AS creatorId, c.name AS creatorName,
    pf.name AS platformName, ch.normalized_url AS normalizedUrl, ch.status
    , ch.provider_channel_id AS providerChannelId, ch.handle
    FROM creator_channels ch
    JOIN creators c ON c.id = ch.creator_id
    JOIN platforms pf ON pf.id = ch.platform_id`;
  if ((!providerChannelId && !handle) || !platformId) {
    return binding.prepare(`${selection} WHERE ch.normalized_url = ? AND ch.deleted_at IS NULL`)
      .bind(normalizedUrl).first<ChannelRow>();
  }
  const matches = await binding.prepare(`${selection}
    WHERE ch.deleted_at IS NULL AND (ch.normalized_url = ?
      OR (? IS NOT NULL AND ch.platform_id = ? AND ch.provider_channel_id = ?)
      OR (? IS NOT NULL AND ch.platform_id = ?
        AND LOWER(LTRIM(ch.handle, '@')) = LOWER(LTRIM(?, '@'))))
    ORDER BY CASE WHEN ch.normalized_url = ? THEN 0 ELSE 1 END, ch.id`)
    .bind(normalizedUrl, providerChannelId, platformId, providerChannelId,
      handle, platformId, handle, normalizedUrl).all<ChannelRow>();
  if (matches.results.length > 1) {
    throw new TelegramStorageError('Для канала найдены конфликтующие записи. Нужна проверка администратора', 409);
  }
  return matches.results[0] ?? null;
}

async function recordExisting(
  binding: D1Database,
  input: { updateId: number; telegramUserId: string; creatorId: number; sourceKind: SourceKind },
  channel: ChannelRow,
) {
  const insertion = await binding.prepare(`INSERT INTO telegram_submissions
    (update_id, telegram_user_id, creator_id, channel_id, source_kind, result_status, created_at)
    VALUES (?, ?, ?, ?, ?, 'existing', ?)
    ON CONFLICT(update_id) DO NOTHING`)
    .bind(input.updateId, input.telegramUserId, input.creatorId, channel.id, input.sourceKind, new Date().toISOString())
    .run();
  const recorded = await findSubmission(binding, input.updateId);
  if (!recorded || recorded.telegramUserId !== input.telegramUserId) {
    throw new TelegramStorageError('Это обновление Telegram уже обработано для другого пользователя', 409);
  }
  return publicChannel(recorded, recorded.submittedCreatorId, recorded.resultStatus, !insertion.meta.changes);
}

export async function submitTelegramChannel(inputValue: unknown) {
  const input = record(inputValue);
  const telegramUserId = telegramId(input.telegramUserId, 'Пользователь Telegram');
  const telegramUpdateId = updateId(input.updateId);
  const submittedSourceKind = sourceKind(input.sourceKind);
  const submittedProviderChannelId = optionalIdentifier(input.providerChannelId, 'ID канала у провайдера');
  const submittedHandle = optionalIdentifier(input.handle, 'Хэндл');
  await ensureDatabase();
  const binding = database();

  await requireTelegramCreatorReady(telegramUserId);
  const previous = await findSubmission(binding, telegramUpdateId);
  if (previous) {
    if (previous.telegramUserId !== telegramUserId) {
      throw new TelegramStorageError('Это обновление Telegram уже обработано для другого пользователя', 409);
    }
    return publicChannel(previous, previous.submittedCreatorId, previous.resultStatus, true);
  }

  const linked = await binding.prepare(`SELECT c.id, c.name, c.type, p.name AS producerName,
    c.status AS creatorStatus, p.status AS producerStatus
    FROM telegram_creator_links t
    JOIN creators c ON c.id = t.creator_id
    JOIN producers p ON p.id = c.producer_id
    WHERE t.telegram_user_id = ?`).bind(telegramUserId).first<BindingRow>();
  if (!linked) throw new TelegramStorageError('Сначала выберите себя в боте', 409);
  if (linked.creatorStatus !== 'active' || linked.producerStatus !== 'active') {
    throw new TelegramStorageError('Привязанный креатор отключён. Выберите себя заново', 409);
  }

  const normalized = normalizeChannelUrl(input.channelUrl);
  const resolvedHandle = submittedHandle ?? normalized.inferredHandle;
  const platform = await binding.prepare(`SELECT id FROM platforms
    WHERE name = ? COLLATE NOCASE AND status = 'active'`)
    .bind(normalized.platformName).first<{ id: number }>();
  if (!platform) throw new TelegramStorageError(`Площадка ${normalized.platformName} отключена`, 409);
  const existing = await findChannel(
    binding,
    normalized.normalizedUrl,
    platform.id,
    submittedProviderChannelId,
    resolvedHandle,
  );
  const submission = {
    updateId: telegramUpdateId,
    telegramUserId,
    creatorId: linked.id,
    sourceKind: submittedSourceKind,
  };
  if (existing) {
    if (existing.creatorId !== linked.id) return recordExisting(binding, submission, existing);
    if (submittedProviderChannelId && existing.providerChannelId
      && existing.providerChannelId !== submittedProviderChannelId) {
      throw new TelegramStorageError('Ссылка не совпадает с ранее определённым ID канала', 409);
    }
    if ((submittedProviderChannelId && !existing.providerChannelId) || (submittedHandle && !existing.handle)) {
      await binding.prepare(`UPDATE creator_channels SET
        provider_channel_id = COALESCE(provider_channel_id, ?),
        handle = COALESCE(handle, ?), updated_at = ?
        WHERE id = ? AND creator_id = ? AND deleted_at IS NULL`)
        .bind(submittedProviderChannelId, submittedHandle, new Date().toISOString(), existing.id, linked.id).run();
    }
    return recordExisting(binding, submission, existing);
  }

  const now = new Date().toISOString();
  try {
    await binding.batch([
      binding.prepare(`INSERT INTO creator_channels
        (creator_id, platform_id, url, normalized_url, provider_channel_id, handle, status, sync_status,
          next_sync_at, consecutive_failures, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', 'pending', ?, 0, ?, ?)`)
        .bind(linked.id, platform.id, normalized.normalizedUrl, normalized.normalizedUrl,
          submittedProviderChannelId, resolvedHandle, now, now, now),
      binding.prepare(`INSERT INTO telegram_submissions
        (update_id, telegram_user_id, creator_id, channel_id, source_kind, result_status, created_at)
        SELECT ?, ?, ?, id, ?, 'created', ? FROM creator_channels WHERE normalized_url = ?`)
        .bind(telegramUpdateId, telegramUserId, linked.id, submittedSourceKind, now, normalized.normalizedUrl),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const racedChannel = /UNIQUE constraint failed: creator_channels\.(?:normalized_url|platform_id)/i.test(message)
      ? await findChannel(binding, normalized.normalizedUrl, platform.id, submittedProviderChannelId, resolvedHandle)
      : null;
    if (racedChannel) return recordExisting(binding, submission, racedChannel);
    const racedSubmission = /UNIQUE constraint failed: telegram_submissions\.update_id/i.test(message)
      ? await findSubmission(binding, telegramUpdateId)
      : null;
    if (racedSubmission?.telegramUserId === telegramUserId) {
      return publicChannel(racedSubmission, racedSubmission.submittedCreatorId, racedSubmission.resultStatus, true);
    }
    throw error;
  }

  const created = await findChannel(binding, normalized.normalizedUrl, platform.id, submittedProviderChannelId, resolvedHandle);
  if (!created) throw new Error('Канал создан, но не найден');
  return publicChannel(created, linked.id, 'created');
}
