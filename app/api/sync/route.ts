import {
  ChannelStorageError,
  claimDueChannels,
  completeChannelSync,
  failChannelSync,
} from '@/db/storage';
import { authorizeSyncRequest } from '@/lib/server/sync-auth';
import { collectorConnection, updateCollectorConnection } from '@/db/social-connections';
import { TelegramStorageError } from '@/db/telegram-onboarding';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function acceptsJson(request: Request) {
  return request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

function requestBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ChannelStorageError('Ожидается JSON-объект', 400);
  }
  return value as Record<string, unknown>;
}

export async function POST(request: Request) {
  const authorization = await authorizeSyncRequest(request);
  if (authorization === 'misconfigured') return json({ error: 'Синхронизация не настроена' }, 503);
  if (authorization !== 'authorized') return json({ error: 'Неверные учётные данные' }, 401);
  if (!acceptsJson(request)) return json({ error: 'Ожидается Content-Type application/json' }, 415);

  let action = '';
  try {
    let parsed: unknown;
    try {
      const raw = await request.text();
      if (raw.length > 32_768) return json({ error: 'Запрос слишком большой' }, 413);
      parsed = JSON.parse(raw);
    } catch {
      throw new ChannelStorageError('Некорректный JSON', 400);
    }
    const body = requestBody(parsed);
    action = typeof body.action === 'string' ? body.action : '';
    if (action === 'connection') return json({ ok: true, connection: await collectorConnection(body) });
    if (action === 'updateConnection') return json({ ok: true, ...await updateCollectorConnection(body) });
    if (action === 'claim') {
      const channels = await claimDueChannels(body.limit);
      return json({ channels });
    }
    if (action === 'complete') {
      const result = await completeChannelSync(body);
      return json({ ok: true, ...result });
    }
    if (action === 'fail') {
      const result = await failChannelSync(body);
      return json({ ok: true, ...result });
    }
    return json({ error: 'Неизвестное действие синхронизации' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка синхронизации';
    const duplicateProvider = /UNIQUE constraint failed: creator_channels\.platform_id, creator_channels\.provider_channel_id/i.test(message);
    const databaseFailure = /(?:D1_ERROR|SQLITE_|database (?:is|error)|no such (?:table|column))/i.test(message);
    const status = error instanceof ChannelStorageError || error instanceof TelegramStorageError ? error.statusCode
      : duplicateProvider ? 409
        : databaseFailure ? 500 : 400;
    console.error(JSON.stringify({ message: 'channel sync request failed', action, status }));
    const clientMessage = duplicateProvider ? 'Канал с таким ID провайдера уже добавлен'
      : status >= 500 ? 'Внутренняя ошибка синхронизации' : message;
    return json({ error: clientMessage }, status);
  }
}
