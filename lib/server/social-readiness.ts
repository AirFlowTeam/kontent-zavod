import { env } from 'cloudflare:workers';
import { integrationStatus } from '@/lib/social-oauth.mjs';

// Only capability flags and public instructions; never expose configuration values.
export function socialReadiness() {
  return integrationStatus(env).map((item) => ({
    platformName: item.platform,
    available: item.ready,
    sharedKeyConfigured: item.sharedKeyConfigured,
    missing: item.missing,
    reason: item.ready
      ? item.platform === 'RuTube' ? 'Ключ не нужен. Публичный источник возвращает ролики и просмотры; лайки недоступны.'
        : item.platform === 'YouTube' ? 'Вход через Google включён. Выберите аккаунт владельца YouTube-канала и разрешите чтение данных. После подтверждения проверим показатели.'
          : 'Официальный вход включён. Войдите аккаунтом владельца и разрешите чтение статистики.'
      : `Администратор ещё не настроил вход ${item.platform}. Ссылка на канал сохранена. Передайте продюсеру название площадки: нужно зарегистрировать и настроить приложение сервиса, получить разрешения площадки и включить вход. После этого вернитесь сюда и подключите аккаунт.`,
  }));
}
