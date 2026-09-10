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
  if (!metrics || ['followers', 'totalViews', 'totalLikes', 'publicationCount', 'reach30d'].every((key) => asNonNegativeInteger(metrics[key]) === null)) {
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
    totalLikes: asNonNegativeInteger(info.channel_like_count),
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
  if (channel.providerChannelId && channel.providerChannelId !== user.secUid) throw new ProviderError('TikTok: изменился владелец адреса канала');
  if (user.privateAccount) throw new ProviderError('TikTok-профиль закрыт. Нужна авторизация владельца', 'needs_auth');
  const stats = info.stats || {};
  const precise = info.statsV2 || {};
  return ensureMetrics({ providerChannelId: user.secUid || null, handle: `@${user.uniqueId}`,
    title: user.nickname || user.uniqueId, avatarUrl: user.avatarLarger || user.avatarMedium || null,
    followers: asNonNegativeInteger(precise.followerCount) ?? asNonNegativeInteger(stats.followerCount),
    totalLikes: asNonNegativeInteger(precise.heartCount) ?? asNonNegativeInteger(precise.heart) ?? asNonNegativeInteger(stats.heartCount) ?? asNonNegativeInteger(stats.heart),
    publicationCount: asNonNegativeInteger(precise.videoCount) ?? asNonNegativeInteger(stats.videoCount),
    totalViews: null, reach30d: null, parserSource: 'tiktok-public-profile' });
}

export function parseInstagramHtml(html, channel) {
  const profiles = findKey(jsonScripts(html), 'xig_user_by_username');
  const user = profiles.find((candidate) => String(candidate?.username || '').toLowerCase() === expectedHandle(channel));
  if (!user) throw new ProviderError('Instagram не отдал публичный профиль; возможны ограничение доступа или изменение страницы', /login|challenge_required|checkpoint_required/i.test(html) ? 'needs_auth' : 'error');
  if (channel.providerChannelId && channel.providerChannelId !== String(user.pk)) throw new ProviderError('Instagram: изменился владелец адреса канала');
  if (user.is_private) throw new ProviderError('Instagram-профиль закрыт. Нужна авторизация владельца', 'needs_auth');
  return ensureMetrics({ providerChannelId: user.pk ? String(user.pk) : null,
    handle: user.username, title: user.full_name || user.username, avatarUrl: user.profile_pic_url || null,
    followers: asNonNegativeInteger(user.follower_count),
    // all_media_count includes photos/carousels, not just videos.
    publicationCount: null, totalLikes: null,
    totalViews: null, reach30d: null, parserSource: 'instagram-public-profile' });
}

export function ytDlpChannelUrl(channel) {
  if (channel.platformName === 'YouTube') return `${channel.url.replace(/\/$/, '')}/about`;
  if (channel.platformName !== 'VK') return channel.url;
  const url = new URL(channel.url);
  const handle = url.pathname.split('/').filter(Boolean).at(-1)?.replace(/^@/, '');
  return `https://vkvideo.ru/@${handle}`;
}

function assignedJson(html, name) {
  const match = new RegExp(`(?:var\\s+)?${name}\\s*=\\s*`).exec(html);
  if (!match) return null;
  const start = match.index + match[0].length;
  if (html[start] !== '{') return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function exactYouTubeCount(value, unit) {
  const text = typeof value === 'string' ? value : value?.simpleText;
  const match = typeof text === 'string' ? text.match(new RegExp(`^(\\d+|\\d{1,3}(?:,\\d{3})+) ${unit}$`, 'i')) : null;
  return match ? asNonNegativeInteger(match[1].replaceAll(',', '')) : null;
}

export function parseYouTubeHtml(html, channel) {
  if (typeof html !== 'string' || html.length > 8_000_000) throw new ProviderError('Ответ YouTube слишком большой');
  const initial = assignedJson(html, 'ytInitialData');
  const about = findKey([initial], 'aboutChannelViewModel')[0];
  const metadata = findKey([initial], 'channelMetadataRenderer')[0];
  const id = metadata?.externalId;
  if (!about || !/^UC[A-Za-z0-9_-]{22}$/.test(id || '')) throw new ProviderError('YouTube не предоставил информацию о канале');
  const requested = new URL(channel.url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if ((channel.providerChannelId && channel.providerChannelId !== id) || (requested[0] === 'channel' && requested[1] !== id)) {
    throw new ProviderError('YouTube вернул другой канал');
  }
  const canonicalPath = (url) => {
    try { const parsed = new URL(url); return ['youtube.com', 'www.youtube.com'].includes(parsed.hostname) ? decodeURIComponent(parsed.pathname).replace(/\/$/, '') : ''; } catch { return ''; }
  };
  const aboutPath = canonicalPath(about.canonicalChannelUrl);
  const vanityPath = canonicalPath(metadata.vanityChannelUrl);
  if (!aboutPath || (aboutPath !== `/channel/${id}` && (!vanityPath.startsWith('/@') || aboutPath.toLowerCase() !== vanityPath.toLowerCase()))) {
    throw new ProviderError('YouTube: информация относится к другому каналу');
  }
  const canonical = [aboutPath, vanityPath, canonicalPath(metadata.channelUrl)].filter(Boolean);
  if (requested[0]?.startsWith('@') && !canonical.some((path) => path.toLowerCase() === `/${requested[0]}`.toLowerCase())) {
    throw new ProviderError('Не удалось подтвердить имя YouTube-канала');
  }
  return ensureMetrics({ providerChannelId: id, handle: canonical.find((path) => path.startsWith('/@'))?.slice(1) ?? null,
    title: metadata.title || null, avatarUrl: metadata.avatar?.thumbnails?.at(-1)?.url ?? null,
    totalViews: exactYouTubeCount(about.viewCountText, 'views?'),
    publicationCount: exactYouTubeCount(about.videoCountText, 'videos?'),
    followers: null, totalLikes: null, reach30d: null, parserSource: 'youtube-public-about' });
}

export function classifyProviderError(error) {
  if (error instanceof ProviderError) return error.kind;
  const message = String(error?.message || error);
  if (/429|rate.?limit|too many requests/i.test(message)) return 'error';
  return /login|log in|sign in|cookies?|authentication|authorize|private|403|401|captcha/i.test(message) ? 'needs_auth' : 'error';
}
