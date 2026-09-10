import {
  submitTelegramChannel,
  TelegramStorageError,
} from '@/db/telegram';
import { getTelegramContext, selectTelegramRole, createTelegramInvite, acceptTelegramInvite,
  selectTelegramCreatorType, listTelegramChannels } from '@/db/telegram-onboarding';
import { authorizeSyncRequest } from '@/lib/server/sync-auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 32 * 1024;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function acceptsJson(request: Request) {
  return request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

function objectBody(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TelegramStorageError('Ожидается JSON-объект', 400);
  }
  return value as Record<string, unknown>;
}

export async function POST(request: Request) {
  const authorization = await authorizeSyncRequest(request);
  if (authorization === 'misconfigured') return json({ error: 'Интеграция Telegram не настроена' }, 503);
  if (authorization !== 'authorized') return json({ error: 'Неверные учётные данные' }, 401);
  if (!acceptsJson(request)) return json({ error: 'Ожидается Content-Type application/json' }, 415);
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: 'Запрос слишком большой' }, 413);
  }

  let action = '';
  try {
    let parsed: unknown;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
        throw new TelegramStorageError('Запрос слишком большой', 413);
      }
      parsed = JSON.parse(raw);
    } catch (error) {
      if (error instanceof TelegramStorageError) throw error;
      throw new TelegramStorageError('Некорректный JSON', 400);
    }
    const body = objectBody(parsed);
    action = typeof body.action === 'string' ? body.action : '';
    if (action === 'context') {
      const context = await getTelegramContext(body);
      return json({ ok: true, ...context });
    }
    if (action === 'bind') {
      return json({ error: 'Выбор чужого профиля отключён. Используйте персональное приглашение продюсера' }, 403);
    }
    if (action === 'role') return json({ ok: true, ...await selectTelegramRole(body) });
    if (action === 'invite') return json({ ok: true, invite: await createTelegramInvite(body) });
    if (action === 'acceptInvite') return json({ ok: true, ...await acceptTelegramInvite(body) });
    if (action === 'selectType') return json({ ok: true, ...await selectTelegramCreatorType(body) });
    if (action === 'channels') return json({ ok: true, channels: await listTelegramChannels(body) });
    if (action === 'submit') {
      const channel = await submitTelegramChannel(body);
      return json({ ok: true, channel }, channel.resultStatus === 'created' && !channel.idempotent ? 201 : 200);
    }
    return json({ error: 'Неизвестное действие Telegram' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось обработать запрос Telegram';
    const duplicate = /UNIQUE constraint failed/i.test(message);
    const databaseFailure = /(?:D1_ERROR|SQLITE_|database (?:is|error)|no such (?:table|column))/i.test(message);
    const status = error instanceof TelegramStorageError ? error.statusCode
      : duplicate ? 409
        : databaseFailure ? 500 : 400;
    if (status >= 500) {
      console.error(JSON.stringify({ message: 'telegram storage request failed', action, status }));
    }
    const clientMessage = status >= 500 ? 'Внутренняя ошибка платформы' : duplicate ? 'Запись уже существует' : message;
    return json({ error: clientMessage }, status);
  }
}
