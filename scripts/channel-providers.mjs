import { ProviderError, asNonNegativeInteger, ensureMetrics, parseTikTokHtml, parseInstagramHtml } from './channel-parser-lib.mjs';

export async function fetchPublicProfile(channel, { fetchImpl = fetch, signal } = {}) {
  const expected = channel.platformName === 'TikTok' ? 'tiktok.com' : 'instagram.com';
  let url = new URL(channel.url);
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (url.protocol !== 'https:' || ![expected, `www.${expected}`].includes(url.hostname) || url.username || url.password || url.port) {
      throw new ProviderError('Площадка перенаправила запрос за пределы своего домена');
    }
    const response = await fetchImpl(url, { redirect: 'manual', signal,
      headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (compatible; KontentZavod/1.0; channel profile statistics)' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new ProviderError('Некорректное перенаправление площадки');
      url = new URL(location, url);
      if (/\/accounts\/login|\/challenge|\/checkpoint/.test(url.pathname)) throw new ProviderError('Площадка требует авторизацию владельца', 'needs_auth');
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError(`Площадка вернула HTTP ${response.status}`, [401, 403].includes(response.status) ? 'needs_auth' : 'error');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError('Пустой ответ площадки');
    const decoder = new TextDecoder();
    let html = ''; let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8_000_000) { await reader.cancel(); throw new ProviderError('Ответ площадки слишком большой'); }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
    return channel.platformName === 'TikTok' ? parseTikTokHtml(html, channel) : parseInstagramHtml(html, channel);
  }
  throw new ProviderError('Слишком много перенаправлений площадки');
}

export async function parseVkProfile(channel, { token, fetchImpl = fetch, signal } = {}) {
  if (!token) return null;
  async function api(method, fields) {
    const response = await fetchImpl(`https://api.vk.com/method/${method}`, { method: 'POST', signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...fields, access_token: token, v: '5.199' }) });
    if (!response.ok) throw new ProviderError(`VK API HTTP ${response.status}`, [401, 403].includes(response.status) ? 'needs_auth' : 'error');
    const payload = await response.json();
    if (payload.error) throw new ProviderError(`VK API: ошибка ${payload.error.error_code}`, [5, 7, 15, 27, 28].includes(payload.error.error_code) ? 'needs_auth' : 'error');
    return payload.response;
  }
  let ownerId = channel.providerChannelId && /^-?\d+$/.test(channel.providerChannelId) ? channel.providerChannelId : null;
  const handle = new URL(channel.url).pathname.split('/').filter(Boolean).at(-1)?.replace(/^@/, '');
  if (!ownerId) {
    const explicit = handle?.match(/^(id|club|public)(\d+)$/);
    if (explicit) ownerId = `${explicit[1] === 'id' ? '' : '-'}${explicit[2]}`;
    else {
      const resolved = await api('utils.resolveScreenName', { screen_name: handle });
      if (!resolved?.object_id || !['group', 'user'].includes(resolved.type)) throw new ProviderError('VK-профиль не найден');
      ownerId = `${resolved.type === 'group' ? '-' : ''}${resolved.object_id}`;
    }
  }
  const group = ownerId.startsWith('-');
  const response = group
    ? await api('groups.getById', { group_ids: ownerId.slice(1), fields: 'members_count,screen_name,photo_200' })
    : await api('users.get', { user_ids: ownerId, fields: 'followers_count,screen_name,photo_200' });
  const profile = (Array.isArray(response) ? response : response?.groups)?.[0];
  if (!profile || String(profile.id) !== ownerId.replace(/^-/, '')) throw new ProviderError('VK вернул другой профиль');
  if (profile.deactivated) throw new ProviderError('VK-профиль удалён или заблокирован');
  return ensureMetrics({ providerChannelId: ownerId, handle: profile.screen_name || handle,
    title: group ? profile.name : [profile.first_name, profile.last_name].filter(Boolean).join(' '),
    avatarUrl: profile.photo_200 || null,
    followers: asNonNegativeInteger(group ? profile.members_count : profile.followers_count),
    totalViews: null, publicationCount: null, reach30d: null, parserSource: 'vk-api-profile' });
}
