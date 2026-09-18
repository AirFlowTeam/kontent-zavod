import { collectAuthorized, isYouTubeOAuthCredentials, refreshAccess, SocialApiError } from '../lib/social-api.mjs';

// Keep token rotation and its durable save before any collection requests.
export async function collectConnectedChannel(channel, connection, options = {}) {
  if (connection?.status !== 'connected' || !connection.credentials?.accessToken) {
    const login = channel.platformName === 'YouTube' ? 'Google' : channel.platformName;
    throw new SocialApiError(`Войдите через ${login} из карточки канала в боте и разрешите чтение статистики.`);
  }
  const requestOptions = { ...options, expectedAccountId: connection.accountId };
  const expiry = Date.parse(connection.expiresAt || '');
  const shouldRefresh = channel.platformName === 'YouTube'
    ? isYouTubeOAuthCredentials(connection.credentials) && (!Number.isFinite(expiry) || expiry <= Date.now() + 5 * 60_000)
    : ['TikTok', 'VK'].includes(channel.platformName)
      || (['Instagram', 'Threads'].includes(channel.platformName)
        && Date.now() - Date.parse(connection.refreshedAt || connection.version) >= 24 * 60 * 60_000);
  if (shouldRefresh) {
    const updated = await refreshAccess(channel.platformName, connection.credentials, requestOptions);
    if (!updated) throw new SocialApiError('Автопродление не настроено. Переподключите аккаунт через официальный вход.');
    if (typeof options.saveConnection !== 'function') throw new SocialApiError('Не удалось сохранить обновлённый доступ. Проверку повторим позже.', 'error');
    const saved = await options.saveConnection(updated, connection.version);
    if (!saved?.version) throw new SocialApiError('Не подтверждено сохранение обновлённого доступа. Проверку повторим позже.', 'error');
    connection = { ...connection, ...updated, version: saved.version };
  }
  return collectAuthorized(channel, connection, requestOptions);
}
