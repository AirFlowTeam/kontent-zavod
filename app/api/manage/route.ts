import {
  ChannelStorageError,
  createChannel,
  createCreator,
  createProducer,
  updateChannel,
  updateCreator,
  updateProducer,
  deleteChannel,
} from '@/db/storage';

export const dynamic = 'force-dynamic';

type ActionHandler = (input: Record<string, unknown>) => Promise<number>;

const actions: ReadonlyMap<string, ActionHandler> = new Map([
  ['createProducer', createProducer],
  ['updateProducer', updateProducer],
  ['createCreator', createCreator],
  ['updateCreator', updateCreator],
  ['createChannel', createChannel],
  ['updateChannel', updateChannel],
  ['deleteChannel', deleteChannel],
]);

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
  if (!acceptsJson(request)) return json({ error: 'Ожидается Content-Type application/json' }, 415);
  try {
    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      throw new ChannelStorageError('Некорректный JSON', 400);
    }
    const body = requestBody(parsed);
    const action = typeof body.action === 'string' ? body.action : '';
    if (action === 'createVideo' || action === 'updateVideo') {
      return json({ error: 'Учёт отдельных роликов удалён; добавьте канал креатора' }, 410);
    }
    const handler = actions.get(action);
    if (!handler) return json({ error: 'Неизвестное действие' }, 400);
    const id = await handler(body);
    return json({ ok: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось сохранить изменения';
    const duplicate = /UNIQUE constraint failed: (creator_channels\.normalized_url|creator_channels\.platform_id, creator_channels\.provider_channel_id)/i.test(message);
    const duplicateName = /UNIQUE constraint failed: (creators|producers)\.name/i.test(message);
    const databaseFailure = /(?:D1_ERROR|SQLITE_|database (?:is|error)|no such (?:table|column))/i.test(message);
    const statusCode = error instanceof ChannelStorageError ? error.statusCode
      : duplicate || duplicateName ? 409
        : databaseFailure ? 500 : 400;
    if (statusCode >= 500) console.error(JSON.stringify({ message: 'management request failed', error: message }));
    const clientMessage = duplicate ? 'Этот канал уже добавлен'
      : duplicateName ? 'Такое имя уже используется'
        : statusCode >= 500 ? 'Не удалось сохранить изменения' : message;
    return json({ error: clientMessage }, statusCode);
  }
}
