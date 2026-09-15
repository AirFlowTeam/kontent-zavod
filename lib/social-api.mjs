// Fixed provider origins only. Never propagate provider bodies/URLs (they may contain tokens).
export class SocialApiError extends Error {
  constructor(message, status = 'needs_auth') { super(message); this.name = 'SocialApiError'; this.syncStatus = status; this.statusCode = 400; }
}
/** @returns {never} */
const fail = (text, status) => { throw new SocialApiError(text, status); };
const number = (v) => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) && Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null;
const sum = (values) => values.every((v) => number(v) !== null) && Number.isSafeInteger(values.reduce((a, b) => a + Number(b), 0)) ? values.reduce((a, b) => a + Number(b), 0) : null;
const origins = new Set(['https://graph.instagram.com', 'https://open.tiktokapis.com', 'https://api.vk.com', 'https://id.vk.ru', 'https://www.googleapis.com']);

async function json(url, init, options) {
  if (!origins.has(new URL(url).origin)) fail('Недопустимый адрес API', 'error');
  let response;
  try { response = await (options.fetchImpl || fetch)(url, { ...init, redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) }); }
  catch { fail('Соцсеть временно не ответила. Повторим автоматически.', 'error'); }
  let payload;
  try {
    const reader = response.body?.getReader();
    const chunks = []; let bytes = 0;
    if (!reader) fail('Пустой ответ API', 'error');
    for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 2_000_000) { await reader.cancel(); fail('Слишком большой ответ API', 'error'); } chunks.push(value); }
    const buffer = new Uint8Array(bytes); let offset = 0; for (const c of chunks) { buffer.set(c, offset); offset += c.length; }
    payload = JSON.parse(new TextDecoder().decode(buffer));
  } catch (error) { if (error instanceof SocialApiError) throw error; fail('Некорректный ответ API', 'error'); }
  if (response.status === 429 || response.status >= 500) fail('Лимит или временная ошибка API. Повторим автоматически.', 'error');
  if ([6, 9, 10, 29].includes(payload.error?.error_code) || [4, 17, 32, 613].includes(payload.error?.code)
    || payload.error?.errors?.some((e) => /quotaExceeded|rateLimitExceeded|dailyLimitExceeded/i.test(e.reason || ''))
    || /rate_limit|internal_error/i.test(payload.error?.code || '')) fail('Лимит или временная ошибка API. Повторим автоматически.', 'error');
  if (!response.ok || (payload.error && payload.error.code !== 'ok')) fail('API не разрешил доступ. Проверьте токен, срок действия и необходимые разрешения.');
  return payload;
}
function handle(channel) { return decodeURIComponent(new URL(channel.url).pathname.split('/').filter(Boolean).at(-1) || '').replace(/^@/, '').toLowerCase(); }
function matchHandle(actual, channel) { if (typeof actual !== 'string' || actual.replace(/^@/, '').toLowerCase() !== handle(channel)) fail('Этот токен выдан другому аккаунту. Подключите доступ владельца указанного канала.'); }
function bearer(token) { return { Authorization: `Bearer ${token}` }; }
function query(url, fields) { const u = new URL(url); for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v)); return u.toString(); }
const ig = (path, token, fields, o) => json(query(`https://graph.instagram.com/v25.0/${path}`, fields), { headers: bearer(token) }, o);
const tt = (path, token, fields, body, o) => json(query(`https://open.tiktokapis.com/v2/${path}/`, { fields }), { method: body ? 'POST' : 'GET', headers: { ...bearer(token), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, o);
let vkNextRequest = 0;
const vk = async (method, token, fields, o) => {
  // Avoid the normal VK user-token request ceiling. No token is used as a map key.
  if (!o.fetchImpl) {
    const delay = Math.max(0, vkNextRequest - Date.now()); vkNextRequest = Date.now() + delay + 400;
    if (delay) await new Promise((resolve, reject) => {
      const stop = () => { clearTimeout(timer); reject(new SocialApiError('Сбор остановлен', 'error')); };
      const timer = setTimeout(() => { o.signal?.removeEventListener('abort', stop); resolve(); }, delay);
      if (o.signal?.aborted) stop(); else o.signal?.addEventListener('abort', stop, { once: true });
    });
  }
  return (await json(`https://api.vk.com/method/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...fields, access_token: token, v: '5.199' }) }, o)).response;
};
const yt = (method, token, fields, o) => json(query(`https://www.googleapis.com/youtube/v3/${method}`, { ...fields, key: token }), {}, o);

export function parseCredentials(input) {
  const token = typeof input.accessToken === 'string' ? input.accessToken.trim() : '';
  if (token.length < 10 || token.length > 8192 || /\s|[<>]/.test(token)) fail('Вставьте только access token или API key, без ссылки, пробелов и пароля.');
  /** @type {{accessToken: string, refreshToken?: string, clientId?: string, deviceId?: string}} */
  const result = { accessToken: token };
  for (const name of ['refreshToken', 'clientId', 'deviceId']) {
    const value = typeof input[name] === 'string' ? input[name].trim() : '';
    if (value.length > 8192 || /\s|[<>]/.test(value)) fail('Некорректные дополнительные поля доступа.');
    if (value) result[name] = value;
  }
  return result;
}

async function youtubeIdentity(channel, token, o) {
  const parts = new URL(channel.url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
  let filter = /^UC[\w-]{22}$/.test(channel.providerChannelId || '') ? { id: channel.providerChannelId }
    : parts[0] === 'channel' ? { id: parts[1] } : parts[0]?.startsWith('@') ? { forHandle: parts[0] }
      : parts[0] === 'user' ? { forUsername: parts[1] } : null;
  if (!filter) fail('Для API YouTube используйте ссылку /@handle или /channel/ID.');
  const data = await yt('channels', token, { ...filter, part: 'id,snippet,statistics,contentDetails' }, o);
  if (data.items?.length !== 1 || !/^UC[\w-]{22}$/.test(data.items[0]?.id)) fail('YouTube API не нашёл канал. Проверьте ссылку и ключ.');
  return data.items[0];
}
async function vkIdentity(channel, token, o) {
  const users = await vk('users.get', token, {}, o);
  const user = users?.[0];
  if (!user?.id) fail('Нужен пользовательский VK access token, не ключ сообщества.');
  let owner;
  const explicit = handle(channel).match(/^(id|club|public)(\d+)$/);
  if (explicit) owner = `${explicit[1] === 'id' ? '' : '-'}${explicit[2]}`;
  else {
    const r = await vk('utils.resolveScreenName', token, { screen_name: handle(channel) }, o);
    if (!r?.object_id || !['group', 'user'].includes(r.type)) fail('VK не нашёл профиль или сообщество.');
    owner = `${r.type === 'group' ? '-' : ''}${r.object_id}`;
  }
  if (!owner.startsWith('-') && String(user.id) !== owner) fail('Токен VK принадлежит другому пользователю.');
  if (/^-?\d+$/.test(channel.providerChannelId || '') && channel.providerChannelId !== owner) fail('Изменился владелец адреса VK. Проверьте канал.');
  if (owner.startsWith('-')) {
    const r = await vk('groups.getById', token, { group_ids: owner.slice(1), fields: 'is_admin' }, o);
    const group = (Array.isArray(r) ? r : r?.groups)?.[0];
    if (String(group?.id) !== owner.slice(1) || group.is_admin !== 1) fail('Токен не подтверждает управление этим VK-сообществом.');
  }
  const page = await vk('video.get', token, { owner_id: owner, count: '1', offset: '0' }, o);
  if (!Array.isArray(page?.items) || number(page.count) === null) fail('VK не предоставил доступ video. Требуется согласование права для приложения.');
  return { accountId: String(user.id), ownerId: owner, username: handle(channel) };
}

export async function inspectAccess(channel, credentials, options = {}) {
  const token = credentials.accessToken;
  if (channel.platformName === 'Instagram') {
    const payload = await ig('me', token, { fields: 'id,user_id,username,account_type,followers_count,media_count' }, options);
    const user = Array.isArray(payload.data) && payload.data.length === 1 ? payload.data[0] : payload;
    if (!/^\d+$/.test(String(user.user_id || ''))) fail('Нужен токен профессионального Instagram-аккаунта через Instagram Login.');
    matchHandle(user.username, channel);
    return { accountId: String(user.user_id), username: user.username, profile: user };
  }
  if (channel.platformName === 'TikTok') {
    const payload = await tt('user/info', token, 'open_id,username,display_name,follower_count,video_count,likes_count', null, options);
    const user = payload.data?.user;
    if (!user?.open_id) fail('TikTok не вернул аккаунт. Нужны разрешения user.info.*.');
    matchHandle(user.username, channel);
    return { accountId: user.open_id, username: user.username, profile: user };
  }
  if (channel.platformName === 'VK') return vkIdentity(channel, token, options);
  if (channel.platformName === 'YouTube') {
    const profile = await youtubeIdentity(channel, token, options);
    return { accountId: profile.id, username: profile.snippet?.customUrl || profile.id, profile };
  }
  fail('Для RuTube ключ не нужен: добавьте публичный канал.');
}

// Bounded permission check, not a partial aggregate. Empty catalogs stay valid.
export async function verifyReadAccess(channel, credentials, options = {}) {
  if (channel.platformName === 'TikTok') {
    const r = await tt('video/list', credentials.accessToken, 'id,view_count,like_count', { max_count: 1 }, options);
    if (!Array.isArray(r.data?.videos)) fail('TikTok не предоставил список видео. Разрешите video.list.');
  }
  if (channel.platformName === 'Instagram') {
    const identity = await inspectAccess(channel, credentials, options);
    const r = await ig(`${identity.accountId}/media`, credentials.accessToken, { fields: 'id,media_type,like_count', limit: 25 }, options);
    if (!Array.isArray(r.data)) fail('Instagram не предоставил публикации.');
    const video = r.data.find((v) => v.media_type === 'VIDEO');
    if (video) await ig(`${video.id}/insights`, credentials.accessToken, { metric: 'views' }, options);
  }
}

function addUnique(map, items, key = 'id') {
  if (!Array.isArray(items)) fail('API вернул неполный список. Старые итоги сохранены.', 'error');
  let added = 0;
  for (const item of items) { const id = String(item?.[key] || ''); if (!id) fail('API вернул видео без ID.', 'error'); if (!map.has(id)) { map.set(id, item); added++; } }
  if (map.size > 100_000) fail('Каталог превышает безопасный лимит: частичные суммы не публикуем.', 'error');
  return added;
}

export async function collectAuthorized(channel, connection, options = {}) {
  const token = connection.credentials.accessToken;
  const identity = await inspectAccess(channel, connection.credentials, options);
  if (connection.accountId && identity.accountId !== connection.accountId) fail('Владелец API-доступа изменился. Подключите канал заново.');
  const base = { handle: identity.username, totalViews: null, totalLikes: null, publicationCount: null, followers: null, reach30d: null };
  const videos = new Map();
  if (channel.platformName === 'Instagram') {
    let after; const cursors = new Set();
    for (let page = 0; ; page++) {
      if (page >= 200) fail('Instagram: не удалось получить полный каталог.', 'error');
      const r = await ig(`${identity.accountId}/media`, token, { fields: 'id,media_type,like_count,owner,username,timestamp', limit: 100, after }, options);
      const added = addUnique(videos, r.data);
      if (!r.paging?.next) break;
      after = r.paging?.cursors?.after;
      if (!after || cursors.has(after) || !added) fail('Instagram: повтор страницы. Частичные суммы не публикуем.', 'error');
      cursors.add(after);
    }
    if (number(identity.profile.media_count) > videos.size || videos.size >= 10_000) fail('Instagram ограничил каталог: полный итог недоступен.', 'error');
    for (const v of videos.values()) {
      if (!['VIDEO', 'IMAGE', 'CAROUSEL_ALBUM'].includes(v.media_type)) fail('Instagram не указал тип публикации. Старые итоги сохранены.', 'error');
      if (String(v.owner?.id || v.owner || '') !== identity.accountId) fail('Instagram не подтвердил владельца публикации.', 'error');
    }
    const own = [...videos.values()].filter((v) => v.media_type === 'VIDEO');
    for (const v of own) {
      if (v.username && v.username.toLowerCase() !== identity.username.toLowerCase()) fail('Instagram вернул видео другого аккаунта.', 'error');
      const r = await ig(`${v.id}/insights`, token, { metric: 'views' }, options);
      v.views = number(r.data?.find((m) => m.name === 'views' && m.period === 'lifetime')?.values?.[0]?.value);
    }
    return { ...base, followers: number(identity.profile.followers_count), publicationCount: own.length, totalLikes: sum(own.map((v) => v.like_count)), totalViews: sum(own.map((v) => v.views)), parserSource: 'instagram-api-own-video-organic' };
  }
  if (channel.platformName === 'TikTok') {
    let cursor; const cursors = new Set();
    for (let page = 0; ; page++) {
      if (page >= 1000) fail('TikTok: каталог не завершён.', 'error');
      const r = (await tt('video/list', token, 'id,create_time,view_count,like_count', { max_count: 20, ...(cursor !== undefined ? { cursor } : {}) }, options)).data;
      const added = addUnique(videos, r?.videos);
      if (r.has_more === false) break;
      if (r.has_more !== true || number(r.cursor) === null || cursors.has(String(r.cursor)) || !added) fail('TikTok: неполная пагинация.', 'error');
      cursor = r.cursor; cursors.add(String(cursor));
    }
    if (number(identity.profile.video_count) !== null && Number(identity.profile.video_count) !== videos.size) fail('TikTok: число видео изменилось или список неполный. Повторим.', 'error');
    return { ...base, followers: number(identity.profile.follower_count), totalViews: sum([...videos.values()].map((v) => v.view_count)), totalLikes: number(identity.profile.likes_count), publicationCount: number(identity.profile.video_count) ?? videos.size, parserSource: 'tiktok-display-api' };
  }
  if (channel.platformName === 'VK') {
    let count;
    for (let offset = 0; ; offset += 200) {
      if (offset >= 100_000) fail('VK: каталог не завершён.', 'error');
      const r = await vk('video.get', token, { owner_id: identity.ownerId, count: '200', offset: String(offset) }, options);
      if (number(r?.count) === null || (count !== undefined && count !== r.count)) fail('VK: каталог изменился во время сбора. Повторим.', 'error');
      count = r.count;
      if (!Array.isArray(r.items) || r.items.some((v) => !/^[1-9]\d*$/.test(String(v.id)) || !/^-?[1-9]\d*$/.test(String(v.owner_id)))) fail('VK вернул некорректный список видео.', 'error');
      const added = addUnique(videos, r.items.map((v) => ({ ...v, key: `${v.owner_id}_${v.id}` })), 'key');
      if (added !== r.items.length) fail('VK повторил видео между страницами. Частичные суммы не публикуем.', 'error');
      if (offset + 200 >= count) break;
    }
    if (videos.size !== Number(count)) fail('VK скрыл часть списка. Полный итог доступных видео не подтверждён.', 'error');
    const own = [...videos.values()].filter((v) => String(v.owner_id) === identity.ownerId && !v.live && !v.upcoming && !v.processing && !v.is_private && !v.platform && (!v.type || v.type === 'video'));
    return { ...base, providerChannelId: identity.ownerId, publicationCount: own.length, totalViews: sum(own.map((v) => v.views)), totalLikes: sum(own.map((v) => v.likes?.count)), parserSource: 'vk-api-own-added-videos-clips-not-guaranteed' };
  }
  if (channel.platformName === 'YouTube') {
    const profile = identity.profile;
    const playlist = profile.contentDetails?.relatedPlaylists?.uploads;
    if (!playlist) fail('YouTube не вернул список загрузок.', 'error');
    let pageToken; const cursors = new Set();
    const ids = new Set();
    for (let page = 0; ; page++) {
      if (page >= 2000) fail('YouTube: каталог не завершён.', 'error');
      const r = await yt('playlistItems', token, { part: 'contentDetails', playlistId: playlist, maxResults: 50, pageToken }, options);
      if (!Array.isArray(r.items)) fail('YouTube вернул неполный список.', 'error');
      let added = 0;
      for (const item of r.items) { const id = item.contentDetails?.videoId; if (!id) fail('YouTube вернул видео без ID.', 'error'); if (!ids.has(id)) { ids.add(id); added++; } }
      if (!r.nextPageToken) break;
      pageToken = r.nextPageToken;
      if (cursors.has(pageToken) || !added) fail('YouTube: повтор страницы.', 'error'); cursors.add(pageToken);
    }
    const allIds = [...ids];
    for (let i = 0; i < allIds.length; i += 50) {
      const r = await yt('videos', token, { part: 'snippet,statistics,status', id: allIds.slice(i, i + 50).join(',') }, options);
      if (!Array.isArray(r.items) || r.items.some((v) => !allIds.slice(i, i + 50).includes(v.id))) fail('YouTube вернул постороннее видео.', 'error');
      addUnique(videos, r.items);
    }
    const own = [...videos.values()].filter((v) => v.snippet?.channelId === identity.accountId && v.status?.privacyStatus === 'public');
    const publicCount = number(profile.statistics?.videoCount);
    return { ...base, providerChannelId: identity.accountId, title: profile.snippet?.title || null,
      followers: profile.statistics?.hiddenSubscriberCount ? null : number(profile.statistics?.subscriberCount),
      totalViews: number(profile.statistics?.viewCount), publicationCount: publicCount,
      totalLikes: publicCount === own.length ? sum(own.map((v) => v.statistics?.likeCount)) : null, parserSource: 'youtube-data-api-full-public' };
  }
  fail('Для площадки нет API-адаптера.', 'error');
}

export async function refreshAccess(platform, credentials, options = {}) {
  let r;
  let state;
  if (platform === 'Instagram') {
    r = await json(query('https://graph.instagram.com/refresh_access_token', { grant_type: 'ig_refresh_token', access_token: credentials.accessToken }), {}, options);
  } else if (platform === 'TikTok') {
    if (!credentials.refreshToken || !options.tiktokClientKey || !options.tiktokClientSecret) return null;
    r = await json('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken, client_key: options.tiktokClientKey, client_secret: options.tiktokClientSecret }) }, options);
  } else if (platform === 'VK') {
    if (!credentials.refreshToken || !credentials.clientId || !credentials.deviceId) return null;
    state = crypto.randomUUID().replaceAll('-', '');
    r = await json('https://id.vk.ru/oauth2/auth', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken, client_id: credentials.clientId, device_id: credentials.deviceId, state,
      ...(options.vkServiceToken && credentials.clientId === options.vkClientId ? { service_token: options.vkServiceToken } : {}) }) }, options);
  } else return null;
  if (!r.access_token || number(r.expires_in) === null || !r.expires_in) fail('API не подтвердил продление доступа.');
  if (platform === 'VK' && r.state !== state) fail('VK не подтвердил состояние запроса продления.');
  const accountId = platform === 'TikTok' ? r.open_id : platform === 'VK' ? r.user_id : null;
  if (['TikTok', 'VK'].includes(platform) && (!accountId || String(accountId) !== options.expectedAccountId)) fail('API продлил доступ другого аккаунта. Подключите канал заново.');
  return { credentials: { ...credentials, accessToken: r.access_token, ...(r.refresh_token ? { refreshToken: r.refresh_token } : {}) }, expiresAt: new Date(Date.now() + Number(r.expires_in) * 1000).toISOString() };
}
