import { collectAuthorized, SocialApiError } from '../lib/social-api.mjs';

export async function collectYouTubeWithPersonalKey(channel, connection, options = {}) {
  if (connection?.status !== 'connected' || !connection.credentials?.accessToken) {
    throw new SocialApiError('Для YouTube нужен личный доступ. Откройте канал в боте → «Подключить YouTube» → войдите через Google и выберите свой канал. Сохранённый ранее API-ключ тоже поддерживается.');
  }
  return collectAuthorized(channel, connection, options);
}
