import { botChannelLink, connectionPage } from '@/lib/server/connection-page';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const botLink = botChannelLink(Number(params.get('channel')));
  if (params.get('paused') === '1') return connectionPage(`<h1>Доступ сохранён</h1><p>Сбор канала приостановлен. Откройте /channels в боте и нажмите «Возобновить сбор»: после этого начнётся первая проверка статистики.</p>${botLink}`);
  return connectionPage(`<h1>Доступ сохранён</h1><p>Первая проверка поставлена в очередь, затем обновляем ежедневно. Результат и доступность показателей смотрите в карточке канала.</p>${botLink}`);
}
