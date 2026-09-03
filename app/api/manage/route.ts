import {
  createCreator,
  createProducer,
  createVideo,
  updateCreator,
  updateProducer,
  updateVideo,
} from '@/db/storage';

export const dynamic = 'force-dynamic';

const actions: Record<string, (input: Record<string, unknown>) => Promise<number>> = {
  createProducer,
  updateProducer,
  createCreator,
  updateCreator,
  createVideo,
  updateVideo,
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const handler = actions[action];
    if (!handler) return Response.json({ error: 'Неизвестное действие' }, { status: 400 });
    const id = await handler(body);
    return Response.json({ ok: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось сохранить изменения';
    const duplicate = /UNIQUE constraint failed: videos\.normalized_url/i.test(message);
    const duplicateName = /UNIQUE constraint failed: (creators|producers)\.name/i.test(message);
    return Response.json(
      { error: duplicate ? 'Этот ролик уже добавлен' : duplicateName ? 'Такое имя уже используется' : message },
      { status: duplicate || duplicateName ? 409 : 400 },
    );
  }
}
