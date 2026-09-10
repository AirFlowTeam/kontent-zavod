export class ProviderError extends Error {
  constructor(message, kind = 'error') { super(message); this.kind = kind; }
}

export function asNonNegativeInteger(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function ensureMetrics(metrics) {
  if (!metrics || ['followers', 'totalViews', 'publicationCount', 'reach30d'].every((key) => asNonNegativeInteger(metrics[key]) === null)) {
    throw new ProviderError('Площадка не предоставила публичные метрики канала');
  }
  return metrics;
}

export function mapYtDlpResult(info, { forceUnknownPublications = false, platformName } = {}) {
  if (!info || typeof info !== 'object' || Array.isArray(info) || info._type !== 'playlist' || info.formats) {
    throw new ProviderError('Парсер не вернул профиль канала');
  }
  const containerIndex = Array.isArray(info.entries) && info.entries.length > 0
    && info.entries.every((entry) => !entry || ['playlist', 'multi_video'].includes(entry._type));
  let providerId = String(info.channel_id || info.uploader_id || '').trim() || null;
  if (platformName === 'VK') {
    const match = String(info.channel_id || info.id || '').match(/^(-?\d+)(?:_all)?$/);
    providerId = match?.[1] ?? null;
  }
  if (platformName === 'YouTube' && !/^UC[A-Za-z0-9_-]{22}$/.test(providerId || '')) providerId = null;
  const thumbnails = Array.isArray(info.thumbnails) ? info.thumbnails : [];
  return ensureMetrics({
    providerChannelId: providerId,
    handle: String(info.uploader_id || '').trim() || null,
    title: String(info.channel || info.uploader || info.title || '').trim() || null,
    avatarUrl: thumbnails.filter((t) => (t?.url || '').startsWith('https://')).sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url ?? null,
    followers: asNonNegativeInteger(info.channel_follower_count),
    // Never infer channel totals from a limited playlist or missing entry counts.
    totalViews: asNonNegativeInteger(info.channel_view_count ?? info.view_count),
    publicationCount: forceUnknownPublications || containerIndex ? null : asNonNegativeInteger(info.channel_video_count ?? info.playlist_count),
    reach30d: null,
    parserSource: 'yt-dlp',
  });
}

function jsonScripts(html) {
  if (typeof html !== 'string' || html.length > 8_000_000) throw new ProviderError('Ответ площадки слишком большой');
  const scripts = [];
  for (const match of html.matchAll(/<script\b[^>]*\btype=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    if (scripts.length >= 100) break;
    try { scripts.push(JSON.parse(match[1])); } catch { /* An unrelated malformed script is not profile data. */ }
  }
  return scripts;
}

function findKey(roots, key) {
  const queue = [...roots];
  const found = [];
  let visited = 0;
  while (queue.length && visited++ < 100_000) {
    const node = queue.pop();
    if (!node || typeof node !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(node, key)) found.push(node[key]);
    for (const value of Object.values(node)) if (value && typeof value === 'object') queue.push(value);
  }
  return found;
}

function expectedHandle(channel) {
  return new URL(channel.url).pathname.split('/').filter(Boolean)[0]?.replace(/^@/, '').toLowerCase();
}

export function parseTikTokHtml(html, channel) {
  const match = html.match(/<script\b[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i);
  let detail;
  try { detail = JSON.parse(match?.[1] || '{}').__DEFAULT_SCOPE__?.['webapp.user-detail']; } catch { /* validated below */ }
  const info = detail?.userInfo;
  const user = info?.user;
  if (!user) throw new ProviderError('TikTok не отдал публичный профиль; возможны ограничение доступа или изменение страницы');
  if (String(user.uniqueId).toLowerCase() !== expectedHandle(channel)) throw new ProviderError('TikTok вернул другой профиль');
  if (user.privateAccount) throw new ProviderError('TikTok-профиль закрыт. Нужна авторизация владельца', 'needs_auth');
  const stats = info.stats || {};
  const precise = info.statsV2 || {};
  return ensureMetrics({ providerChannelId: user.secUid || null, handle: `@${user.uniqueId}`,
    title: user.nickname || user.uniqueId, avatarUrl: user.avatarLarger || user.avatarMedium || null,
    followers: asNonNegativeInteger(precise.followerCount) ?? asNonNegativeInteger(stats.followerCount),
    publicationCount: asNonNegativeInteger(precise.videoCount) ?? asNonNegativeInteger(stats.videoCount),
    totalViews: null, reach30d: null, parserSource: 'tiktok-public-profile' });
}

export function parseInstagramHtml(html, channel) {
  const profiles = findKey(jsonScripts(html), 'xig_user_by_username');
  const user = profiles.find((candidate) => String(candidate?.username || '').toLowerCase() === expectedHandle(channel));
  if (!user) throw new ProviderError('Instagram не отдал публичный профиль; возможны ограничение доступа или изменение страницы', /login|challenge_required|checkpoint_required/i.test(html) ? 'needs_auth' : 'error');
  if (user.is_private) throw new ProviderError('Instagram-профиль закрыт. Нужна авторизация владельца', 'needs_auth');
  return ensureMetrics({ providerChannelId: user.pk ? String(user.pk) : null,
    handle: user.username, title: user.full_name || user.username, avatarUrl: user.profile_pic_url || null,
    followers: asNonNegativeInteger(user.follower_count),
    publicationCount: asNonNegativeInteger(user.all_media_count) ?? asNonNegativeInteger(user.media_count),
    totalViews: null, reach30d: null, parserSource: 'instagram-public-profile' });
}

export function ytDlpChannelUrl(channel) {
  if (channel.platformName === 'YouTube') return `${channel.url.replace(/\/$/, '')}/about`;
  if (channel.platformName !== 'VK') return channel.url;
  const url = new URL(channel.url);
  const handle = url.pathname.split('/').filter(Boolean).at(-1)?.replace(/^@/, '');
  return `https://vkvideo.ru/@${handle}`;
}

export function classifyProviderError(error) {
  if (error instanceof ProviderError) return error.kind;
  const message = String(error?.message || error);
  if (/429|rate.?limit|too many requests/i.test(message)) return 'error';
  return /login|log in|sign in|cookies?|authentication|authorize|private|403|401|captcha/i.test(message) ? 'needs_auth' : 'error';
}
