import { botLink, connectionPage } from '@/lib/server/connection-page';
export async function GET() {
  return connectionPage(`<h1>Доступ сохранён</h1><p>Первая проверка поставлена в очередь, затем обновляем ежедневно. Результат и доступность показателей смотрите в карточке канала.</p>${botLink}`);
}
