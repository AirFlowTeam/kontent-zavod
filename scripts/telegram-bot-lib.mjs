const SUPPORTED_HOSTS = new Set([
  'youtube.com',
  'youtu.be',
  'rutube.ru',
  'vk.com',
  'vkvideo.ru',
  'tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
  'instagram.com',
]);

const MAX_SAFE_TELEGRAM_USER_ID = BigInt(Number.MAX_SAFE_INTEGER);

export function parseTelegramAdminUserIds(value = '') {
  const raw = String(value ?? '').trim();
  if (!raw) return new Set();

  const ids = raw.split(',').map((item) => item.trim());
  if (ids.some((id) => !/^[1-9]\d{0,15}$/.test(id) || BigInt(id) > MAX_SAFE_TELEGRAM_USER_ID)) {
    throw new Error('TELEGRAM_ADMIN_USER_IDS contains an invalid Telegram user ID');
  }
  return new Set(ids.map((id) => BigInt(id).toString()));
}

function cleanHost(hostname) {
  const host = hostname.toLowerCase().replace(/^(?:www\.|m\.)/, '');
  return host === 'vk.ru' ? 'vk.com' : host;
}

function safeHttpUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed;
  } catch {
    return null;
  }
}

// The installed extractor may only recognize vk.com. Preserve the video path
// and query while treating VK's .ru domain as the same provider, not a new site.
export function normalizeVkSourceUrl(value) {
  const parsed = safeHttpUrl(value);
  if (parsed && /^(?:(?:www|m)\.)?vk\.ru$/i.test(parsed.hostname)) {
    parsed.hostname = 'vk.com';
    return parsed.toString();
  }
  return value;
}

function trimUrlPunctuation(value) {
  return value.replace(/[\],.!?;:}]+$/u, '').replace(/\)+$/u, (ending) => {
    const prefix = value.slice(0, -ending.length);
    const opening = (prefix.match(/\(/gu) ?? []).length;
    const closing = (prefix.match(/\)/gu) ?? []).length;
    return ')'.repeat(Math.max(0, Math.min(ending.length, opening - closing)));
  });
}

export function extractMessageUrls(message) {
  if (!message || typeof message !== 'object') return [];
  const urls = new Set();
  const fields = [
    [message.text, message.entities],
    [message.caption, message.caption_entities],
  ];
  for (const [text, entities] of fields) {
    if (typeof text !== 'string') continue;
    if (Array.isArray(entities)) {
      for (const entity of entities) {
        if (entity?.type === 'text_link' && safeHttpUrl(entity.url)) urls.add(entity.url.trim());
        if (entity?.type === 'url' && Number.isInteger(entity.offset) && Number.isInteger(entity.length)) {
          const candidate = text.slice(entity.offset, entity.offset + entity.length);
          if (safeHttpUrl(candidate)) urls.add(trimUrlPunctuation(candidate));
        }
      }
    }
    for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/giu)) {
      const candidate = trimUrlPunctuation(match[0]);
      if (safeHttpUrl(candidate)) urls.add(candidate);
    }
  }
  return [...urls];
}

export function extractMessageUrl(message) { return extractMessageUrls(message)[0] ?? null; }

function channelResult(candidate, sourceKind = 'channel') {
  return { supported: true, sourceKind, needsResolution: false, candidates: [candidate] };
}

function videoResult() {
  return { supported: true, sourceKind: 'video', needsResolution: true, candidates: [] };
}

export function inspectSubmittedUrl(value) {
  const parsed = safeHttpUrl(value);
  if (!parsed) return { supported: false, reason: 'invalid', candidates: [] };
  const host = cleanHost(parsed.hostname);
  if (!SUPPORTED_HOSTS.has(host)) return { supported: false, reason: 'platform', candidates: [] };
  const segments = parsed.pathname.split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  const first = (segments[0] ?? '').toLowerCase();

  if (host === 'youtube.com') {
    if (first.startsWith('@') && first.length > 1) {
      const channelTabs = new Set(['about', 'community', 'featured', 'playlists', 'shorts', 'streams', 'videos']);
      if (segments.length === 1 || (segments.length === 2 && channelTabs.has((segments[1] ?? '').toLowerCase()))) {
        return channelResult(`https://youtube.com/${first}`);
      }
      return videoResult();
    }
    if (['channel', 'c', 'user'].includes(first) && segments[1]) {
      const channelTabs = new Set(['about', 'community', 'featured', 'playlists', 'shorts', 'streams', 'videos']);
      if (segments.length === 2 || (segments.length === 3 && channelTabs.has((segments[2] ?? '').toLowerCase()))) {
        return channelResult(`https://youtube.com/${first}/${segments[1]}`);
      }
      return videoResult();
    }
    return videoResult();
  }
  if (host === 'youtu.be') return videoResult();

  if (host === 'rutube.ru') {
    if (first === 'video' && (segments[1] ?? '').toLowerCase() === 'person' && segments[2]) {
      return channelResult(`https://rutube.ru/channel/${segments[2]}`);
    }
    if (['channel', 'u'].includes(first) && segments[1]) {
      return channelResult(`https://rutube.ru/${first}/${segments[1]}`);
    }
    return videoResult();
  }

  if (host === 'tiktok.com') {
    if (first.startsWith('@') && first.length > 1) {
      if (segments.length === 1) return channelResult(`https://tiktok.com/${first}`);
      return videoResult();
    }
    return videoResult();
  }
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return videoResult();

  if (host === 'instagram.com') {
    const contentRoutes = new Set(['p', 'reel', 'reels', 'stories', 'tv']);
    if (first && !contentRoutes.has(first) && !['accounts', 'direct', 'explore'].includes(first)) {
      const channelTabs = new Set(['reels', 'tagged']);
      if (segments.length === 1 || (segments.length === 2 && channelTabs.has((segments[1] ?? '').toLowerCase()))) {
        return channelResult(`https://instagram.com/${first}`);
      }
      return videoResult();
    }
    return videoResult();
  }

  if (host === 'vk.com' || host === 'vkvideo.ru') {
    const queryContainsMedia = [...parsed.searchParams.values()]
      .some((item) => /^(?:video|clip|wall|photo|story|market)-?\d+(?:_|$)/i.test(item));
    const mediaRoute = /^(?:video|clip|wall|photo|story|market)(?:-?\d+(?:_|$)|[-_]|$)/i;
    const reservedRoute = /^(?:away|feed|im|login|search|share)$/i;
    if (segments.length === 1 && !queryContainsMedia && !mediaRoute.test(segments[0]) && !reservedRoute.test(segments[0])) {
      return channelResult(`https://${host}/${segments[0]}`);
    }
    return videoResult();
  }

  return { supported: false, reason: 'platform', candidates: [] };
}

function addCandidate(result, value, expectedHosts) {
  const parsed = safeHttpUrl(value);
  if (!parsed) return;
  const host = cleanHost(parsed.hostname);
  if (!expectedHosts.has(host)) return;
  parsed.protocol = 'https:';
  parsed.hostname = host;
  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';
  result.add(parsed.toString());
}

function cleanIdentity(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().replace(/^@/, '');
}

function metadataNodes(info) {
  const nodes = [];
  const queue = [info];
  const seen = new Set();
  while (queue.length && nodes.length < 24) {
    const node = queue.shift();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    nodes.push(node);
    if (Array.isArray(node.entries)) queue.push(...node.entries);
  }
  return nodes;
}

function firstIdentity(nodes, keys, predicate = (value) => Boolean(value)) {
  for (const node of nodes) {
    for (const key of keys) {
      const value = cleanIdentity(node[key]);
      if (predicate(value)) return value;
    }
  }
  return '';
}

function firstPathHandle(nodes, expectedHost) {
  for (const node of nodes) {
    for (const key of ['webpage_url', 'original_url']) {
      const parsed = safeHttpUrl(node[key]);
      if (!parsed || cleanHost(parsed.hostname) !== expectedHost) continue;
      const identity = cleanIdentity(parsed.pathname.split('/').filter(Boolean)[0] ?? '');
      if (/^[A-Za-z0-9._-]{2,64}$/.test(identity)) return identity;
    }
  }
  return '';
}

export function channelCandidatesFromInfo(info, sourceUrl) {
  return channelDescriptorsFromInfo(info, sourceUrl).map((item) => item.url);
}

function descriptor(url, providerChannelId = null, handle = null) {
  return { url, providerChannelId: providerChannelId || null, handle: handle || null };
}

export function directChannelDescriptor(value) {
  const inspected = inspectSubmittedUrl(value);
  if (!inspected.supported || inspected.needsResolution || inspected.candidates.length !== 1) return null;
  const url = inspected.candidates[0];
  const parsed = safeHttpUrl(url);
  if (!parsed) return null;
  const host = cleanHost(parsed.hostname);
  const segments = parsed.pathname.split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  const first = segments[0] ?? '';
  if (host === 'youtube.com') {
    if (first.toLowerCase() === 'channel' && segments[1]) return descriptor(url, segments[1]);
    if (first.startsWith('@')) return descriptor(url, null, first);
    if (['c', 'user'].includes(first.toLowerCase()) && segments[1]) return descriptor(url, null, segments[1]);
  }
  if (host === 'rutube.ru') {
    if (first.toLowerCase() === 'channel' && /^\d+$/.test(segments[1] ?? '')) {
      return descriptor(url, segments[1], segments[1]);
    }
    if (first.toLowerCase() === 'u' && segments[1]) return descriptor(url, null, segments[1]);
  }
  if (host === 'tiktok.com' && first.startsWith('@')) return descriptor(url, null, first);
  if (host === 'instagram.com' && first) return descriptor(url, null, first);
  if (host === 'vk.com' || host === 'vkvideo.ru') {
    const personal = first.match(/^id(\d+)$/i);
    const community = first.match(/^(?:club|public)(\d+)$/i);
    if (personal) return descriptor(url, personal[1], first);
    if (community) return descriptor(url, `-${community[1]}`, first);
    return descriptor(url, null, first);
  }
  return descriptor(url);
}

export function channelDescriptorsFromInfo(info, sourceUrl) {
  const candidates = new Set();
  if (!info || typeof info !== 'object') return [];
  const nodes = metadataNodes(info);
  const source = safeHttpUrl(sourceUrl);
  const host = source ? cleanHost(source.hostname) : '';

  if (host === 'youtube.com' || host === 'youtu.be') {
    const expectedHosts = new Set(['youtube.com']);
    const channelId = firstIdentity(nodes, ['channel_id'], (value) => /^[A-Za-z0-9_-]{6,128}$/.test(value));
    if (channelId) {
      addCandidate(candidates, `https://youtube.com/channel/${encodeURIComponent(channelId)}`, expectedHosts);
      const handle = firstIdentity(nodes, ['uploader_id'], (value) => /^[A-Za-z0-9._-]{2,64}$/.test(value));
      return [...candidates].slice(0, 1).map((url) => descriptor(url, channelId, handle));
    }
    for (const node of nodes) {
      addCandidate(candidates, node.channel_url, expectedHosts);
      addCandidate(candidates, node.uploader_url, expectedHosts);
      if (candidates.size) return [...candidates].slice(0, 1).map((url) => descriptor(url));
    }
  }
  if (host.includes('tiktok.com')) {
    const expectedHosts = new Set(['tiktok.com']);
    const validHandle = (value) => /^[A-Za-z0-9._-]{2,64}$/.test(value) && !/^\d+$/.test(value);
    const handle = firstIdentity(nodes, ['uploader'], validHandle)
      || firstPathHandle(nodes, 'tiktok.com');
    if (handle) addCandidate(candidates, `https://tiktok.com/@${encodeURIComponent(handle)}`, expectedHosts);
    const providerChannelId = firstIdentity(nodes, ['channel_id']);
    return [...candidates].slice(0, 1).map((url) => descriptor(url, providerChannelId, handle ? `@${handle}` : null));
  }
  if (host === 'instagram.com') {
    const expectedHosts = new Set(['instagram.com']);
    const validHandle = (value) => /^[A-Za-z0-9._]{2,64}$/.test(value) && !/^\d+$/.test(value);
    const handle = firstIdentity(nodes, ['channel', 'uploader'], validHandle);
    if (handle) addCandidate(candidates, `https://instagram.com/${encodeURIComponent(handle)}`, expectedHosts);
    const providerChannelId = firstIdentity(nodes, ['uploader_id']);
    return [...candidates].slice(0, 1).map((url) => descriptor(url, providerChannelId, handle));
  }
  if (host === 'rutube.ru') {
    const expectedHosts = new Set(['rutube.ru']);
    const identity = firstIdentity(nodes, ['channel_id', 'uploader_id'], (value) => /^\d+$/.test(value));
    if (identity) addCandidate(candidates, `https://rutube.ru/channel/${encodeURIComponent(identity)}`, expectedHosts);
    return [...candidates].slice(0, 1).map((url) => descriptor(url, identity));
  }
  if (host === 'vk.com' || host === 'vkvideo.ru') {
    const expectedHosts = new Set(['vk.com', 'vkvideo.ru']);
    const identity = firstIdentity(nodes, ['uploader_id', 'channel_id'], (value) => /^-?\d+$/.test(value));
    if (/^-\d+$/.test(identity)) addCandidate(candidates, `https://vk.com/club${identity.slice(1)}`, expectedHosts);
    else if (/^\d+$/.test(identity)) addCandidate(candidates, `https://vk.com/id${identity}`, expectedHosts);
    return [...candidates].slice(0, 1).map((url) => descriptor(url, identity));
  }

  return [];
}
