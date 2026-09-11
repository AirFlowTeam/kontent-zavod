import { ProviderError, asNonNegativeInteger } from './channel-parser-lib.mjs';

// Profile.video_count is not the number of public uploads. Count the complete
// owner-scoped listing (including Shorts), never a profile total or a sample.
export async function parseRutubeProfile(channel, { profileId, fetchImpl = fetch, signal, maxPages = 200 } = {}) {
  const source = new URL(channel.url);
  if (source.protocol !== 'https:' || source.username || source.password || source.port
    || !['rutube.ru', 'www.rutube.ru'].includes(source.hostname)) {
    throw new ProviderError('Некорректный адрес RuTube-канала');
  }
  const pathId = source.pathname.match(/^\/(?:channel|video\/person)\/(\d+)\/?$/)?.[1];
  const id = String(profileId || channel.providerChannelId || pathId || '');
  if (!/^\d+$/.test(id)) throw new ProviderError('Не удалось определить ID RuTube-канала');
  if ((pathId && pathId !== id) || (channel.providerChannelId && String(channel.providerChannelId) !== id)) {
    throw new ProviderError('RuTube: изменился владелец адреса канала');
  }
  async function get(path) {
    const response = await fetchImpl(new URL(path, 'https://rutube.ru'), { signal, redirect: 'error',
      headers: { accept: 'application/json', referer: channel.url, 'user-agent': 'KontentZavod/1.0 (public channel statistics)' } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError(`RuTube: HTTP ${response.status}`, [401, 403].includes(response.status) ? 'needs_auth' : 'error');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError('RuTube: пустой ответ');
    const decoder = new TextDecoder();
    let text = '', bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) { await reader.cancel(); throw new ProviderError('RuTube: ответ слишком большой'); }
      text += decoder.decode(value, { stream: true });
    }
    try { return JSON.parse(text + decoder.decode()); }
    catch { throw new ProviderError('RuTube: некорректный ответ'); }
  }

  const profile = await get(`/api/profile/user/${id}/`);
  if (String(profile?.id) !== id) throw new ProviderError('RuTube вернул другой профиль');
  const seen = new Set();
  const videos = new Map();
  let totalPages;
  let complete = false;
  const listingPath = `/api/video/person/${id}/`;
  for (let page = 1; page <= maxPages; page++) {
    const data = await get(`${listingPath}?page=${page}&format=json`);
    const pages = asNonNegativeInteger(data?.num_pages);
    if (!Array.isArray(data?.results) || asNonNegativeInteger(data.page) !== page || pages === null
      || typeof data.has_next !== 'boolean' || (page > 1 && pages !== totalPages)) {
      throw new ProviderError('RuTube: не удалось подтвердить полноту списка роликов');
    }
    totalPages = pages;
    if (data.has_next ? pages <= page : pages !== page && !(page === 1 && pages === 0 && data.results.length === 0)) {
      throw new ProviderError('RuTube: противоречивое количество страниц');
    }
    const before = seen.size;
    for (const video of data.results) {
      if (!video || typeof video.id !== 'string' || !video.id.trim() || String(video.author?.id) !== id) {
        throw new ProviderError('RuTube: список содержит ролик другого канала или некорректный ID');
      }
      seen.add(video.id);
      if (seen.size > 100_000) throw new ProviderError('RuTube: слишком много записей; неполный итог не сохранён');
      // Missing visibility/type flags are not evidence of a public video.
      if (['is_hidden', 'is_deleted', 'is_audio', 'is_livestream'].some((key) => typeof video[key] !== 'boolean')) {
        throw new ProviderError('RuTube: не удалось определить тип и доступность публикации');
      }
      if (video.is_hidden || video.is_deleted || video.is_audio || video.is_livestream) continue;
      if (typeof video.publication_ts !== 'string' || !Number.isFinite(Date.parse(video.publication_ts))) {
        throw new ProviderError('RuTube: не удалось подтвердить публикацию ролика');
      }
      if (!videos.has(video.id)) videos.set(video.id, asNonNegativeInteger(video.hits));
    }
    if (page > 1 && seen.size === before) throw new ProviderError('RuTube: неполный или повторяющийся список роликов');
    if (!data.has_next) {
      if (data.next != null) throw new ProviderError('RuTube: противоречивое продолжение списка');
      complete = true;
      break;
    }
    if (seen.size === before || typeof data.next !== 'string') throw new ProviderError('RuTube: неполный или повторяющийся список роликов');
    const next = new URL(data.next, 'https://rutube.ru');
    if (next.origin !== 'https://rutube.ru' || next.username || next.password || next.pathname !== listingPath
      || next.searchParams.get('page') !== String(page + 1)) {
      throw new ProviderError('RuTube: некорректная следующая страница');
    }
  }
  if (!complete) throw new ProviderError('RuTube: список роликов превышает лимит проверки; неполный итог не сохранён');
  const counts = [...videos.values()];
  const totalViews = counts.some((value) => value === null) ? null : asNonNegativeInteger(counts.reduce((sum, value) => sum + value, 0));
  return {
    providerChannelId: id, handle: null, title: String(profile.name || '').trim() || null,
    avatarUrl: profile.avatar_url || null, followers: asNonNegativeInteger(profile.subscribers_count),
    totalViews, publicationCount: videos.size, totalLikes: null, reach30d: null,
    // Do not compare historical profile counters with this new public scope.
    parserSource: 'rutube-public-videos',
  };
}
