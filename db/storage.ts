import { env } from 'cloudflare:workers';

type Status = 'active' | 'inactive';
type VideoStatus = 'active' | 'deleted' | 'error';
type CreatorType = 'UGC' | 'AI';
type ChannelSyncStatus = 'pending' | 'success' | 'error' | 'needs_auth';
type ChannelSyncFailureStatus = Extract<ChannelSyncStatus, 'error' | 'needs_auth'>;
type SupportedPlatformName = 'YouTube' | 'RuTube' | 'VK' | 'TikTok' | 'Instagram';

const producersSeed = [
  [1, 'Анна', 'active', '2026-08-12T09:00:00.000Z'],
  [2, 'Сергей', 'active', '2026-08-14T09:00:00.000Z'],
  [3, 'Ольга', 'active', '2026-08-20T09:00:00.000Z'],
] as const;

const platformsSeed = [
  [1, 'Instagram', ['instagram.com']],
  [2, 'TikTok', ['tiktok.com']],
  [3, 'YouTube', ['youtube.com', 'youtu.be']],
  [4, 'VK', ['vk.com', 'vkvideo.ru']],
  [5, 'RuTube', ['rutube.ru']],
] as const;

const creatorsSeed = [
  [1, 'Иван', 'UGC', 1],
  [2, 'Максим', 'UGC', 1],
  [3, 'Мария', 'UGC', 2],
  [4, 'Лера', 'UGC', 3],
  [5, 'AI-01', 'AI', 2],
  [6, 'AI-02', 'AI', 3],
] as const;

const videosSeed = [
  [1, 1, 2, 'https://www.tiktok.com/@kontent/video/700000000001', '2026-09-01', 185000, 'active'],
  [2, 1, 1, 'https://www.instagram.com/reel/demo000001', '2026-09-02', 128500, 'active'],
  [3, 1, 3, 'https://www.youtube.com/shorts/demo000001', '2026-09-03', 342000, 'active'],
  [4, 2, 2, 'https://www.tiktok.com/@kontent/video/700000000002', '2026-09-01', 96000, 'active'],
  [5, 2, 1, 'https://www.instagram.com/reel/demo000002', '2026-09-02', 214000, 'active'],
  [6, 2, 4, 'https://vk.com/clip-100000_456239001', '2026-09-03', 78000, 'active'],
  [7, 3, 2, 'https://www.tiktok.com/@kontent/video/700000000003', '2026-09-01', 153000, 'active'],
  [8, 3, 5, 'https://rutube.ru/video/00000000000000000000000000000001', '2026-09-02', 57000, 'active'],
  [9, 3, 3, 'https://youtu.be/demo000002', '2026-09-03', 189000, 'active'],
  [10, 4, 1, 'https://www.instagram.com/reel/demo000003', '2026-09-01', 112000, 'active'],
  [11, 4, 4, 'https://vk.com/clip-100000_456239002', '2026-09-02', 69000, 'active'],
  [12, 5, 2, 'https://www.tiktok.com/@aifactory/video/700000000004', '2026-09-01', 421000, 'active'],
  [13, 5, 3, 'https://www.youtube.com/shorts/demo000003', '2026-09-02', 508000, 'active'],
  [14, 5, 1, 'https://www.instagram.com/reel/demo000004', '2026-09-03', 376000, 'active'],
  [15, 6, 2, 'https://www.tiktok.com/@aifactory/video/700000000005', '2026-09-01', 294000, 'active'],
  [16, 6, 5, 'https://rutube.ru/video/00000000000000000000000000000002', '2026-09-02', 147000, 'active'],
  [17, 6, 4, 'https://vk.com/clip-100000_456239003', '2026-09-03', 233000, 'active'],
  [18, 4, 2, 'https://www.tiktok.com/@kontent/video/700000000006', '2026-09-03', 0, 'error'],
] as const;

function db() {
  if (!env.DB) throw new Error('База данных временно недоступна');
  return env.DB;
}

export function normalizeUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('Укажите корректную ссылку на ролик');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Укажите ссылку, начинающуюся с http:// или https://');
  parsed.protocol = 'https:';
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
  if (parsed.hostname === 'vk.ru') parsed.hostname = 'vk.com';
  parsed.hash = '';
  const tracking = new Set([
    '_r', '_t', 'fbclid', 'feature', 'gclid', 'igsh', 'igshid', 'is_copy_url',
    'is_from_webapp', 'refer', 'sender_device', 'sender_web_id', 'share_app_id',
    'share_id', 'share_item_id', 'share_link_id', 'si', 'social_sharing',
    'timestamp', 'tt_from',
  ]);
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (key.toLowerCase().startsWith('utm_') || tracking.has(key.toLowerCase())) parsed.searchParams.delete(key);
  }
  const pathParts = parsed.pathname.split('/').filter(Boolean);
  let youtubeId = '';
  if (parsed.hostname === 'youtu.be') {
    youtubeId = pathParts[0] ?? '';
  } else if (parsed.hostname === 'youtube.com') {
    if (pathParts[0] === 'watch') youtubeId = parsed.searchParams.get('v') ?? '';
    if (['shorts', 'embed', 'live', 'v'].includes(pathParts[0] ?? '')) youtubeId = pathParts[1] ?? '';
  }
  if (youtubeId) {
    parsed.hostname = 'youtube.com';
    parsed.pathname = '/watch';
    parsed.search = '';
    parsed.searchParams.set('v', youtubeId);
    return parsed.toString();
  }
  parsed.searchParams.sort();
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString();
}

export interface NormalizedChannelUrl {
  normalizedUrl: string;
  platformName: SupportedPlatformName;
  inferredHandle: string | null;
}

function channelUrl(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > 2048) throw new Error('Укажите корректную ссылку на канал');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Укажите корректную ссылку на канал');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Ссылка на канал должна начинаться с http:// или https://');
  }
  parsed.protocol = 'https:';
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
  if (parsed.hostname === 'vk.ru') parsed.hostname = 'vk.com';
  parsed.port = '';
  parsed.hash = '';
  if ((parsed.hostname === 'vk.com' || parsed.hostname === 'vkvideo.ru')
    && [...parsed.searchParams.values()].some((item) => /^(?:video|clip|wall|photo|story|market)-?\d+(?:_|$)/i.test(item))) {
    throw new Error('Укажите ссылку на VK-сообщество или профиль, а не на публикацию');
  }
  parsed.search = '';
  return parsed;
}

function decodedPathSegments(parsed: URL) {
  try {
    return parsed.pathname.split('/').filter(Boolean).map((part) => {
      const decoded = decodeURIComponent(part).trim().normalize('NFC');
      if (!decoded || decoded.includes('/') || decoded.includes('\\')) throw new Error('invalid path');
      return decoded;
    });
  } catch {
    throw new Error('В ссылке на канал есть некорректный путь');
  }
}

function canonicalChannelResult(
  parsed: URL,
  hostname: string,
  segments: string[],
  platformName: SupportedPlatformName,
  inferredHandle: string | null,
): NormalizedChannelUrl {
  parsed.hostname = hostname;
  parsed.pathname = `/${segments.join('/')}`;
  const normalizedUrl = parsed.toString().replace(/\/$/, '');
  return { normalizedUrl, platformName, inferredHandle };
}

export function normalizeChannelUrl(value: unknown): NormalizedChannelUrl {
  const parsed = channelUrl(value);
  const segments = decodedPathSegments(parsed);
  const first = (segments[0] ?? '').toLowerCase();

  if (parsed.hostname === 'youtube.com') {
    const contentRoutes = new Set(['watch', 'shorts', 'live', 'playlist', 'embed', 'clip', 'v', 'feed']);
    if (!first || contentRoutes.has(first)) throw new Error('Укажите ссылку на YouTube-канал, а не на видео');
    if (first.startsWith('@') && first.length > 1) {
      return canonicalChannelResult(parsed, 'youtube.com', [first], 'YouTube', first);
    }
    if (['channel', 'c', 'user'].includes(first) && segments[1]) {
      const identity = first === 'channel' ? segments[1] : segments[1].toLowerCase();
      return canonicalChannelResult(parsed, 'youtube.com', [first, identity], 'YouTube', first === 'channel' ? null : identity);
    }
    throw new Error('Поддерживаются YouTube-ссылки вида /@name, /channel/id, /c/name или /user/name');
  }
  if (parsed.hostname === 'youtu.be') throw new Error('Короткая YouTube-ссылка ведёт на видео, а не на канал');

  if (parsed.hostname === 'rutube.ru') {
    if (first === 'video' && (segments[1] ?? '').toLowerCase() === 'person' && segments[2]) {
      return canonicalChannelResult(parsed, 'rutube.ru', ['channel', segments[2]], 'RuTube', segments[2]);
    }
    if (!['channel', 'u'].includes(first) || !segments[1]) {
      throw new Error('Укажите ссылку на RuTube-канал вида /channel/id, /video/person/id или /u/name');
    }
    const identity = first === 'u' ? segments[1].toLowerCase() : segments[1];
    return canonicalChannelResult(parsed, 'rutube.ru', [first, identity], 'RuTube', identity);
  }

  if (parsed.hostname === 'tiktok.com') {
    if (!first.startsWith('@') || first.length < 2 || segments.length !== 1) {
      throw new Error('Укажите ссылку на TikTok-профиль вида /@name');
    }
    return canonicalChannelResult(parsed, 'tiktok.com', [first], 'TikTok', first);
  }

  if (parsed.hostname === 'instagram.com') {
    const reserved = new Set(['accounts', 'direct', 'explore', 'p', 'reel', 'reels', 'stories', 'tv']);
    const allowedSubpages = new Set(['reels', 'tagged']);
    if (!first || reserved.has(first) || (segments.length > 1 && !allowedSubpages.has((segments[1] ?? '').toLowerCase()))) {
      throw new Error('Укажите ссылку на Instagram-профиль, а не на публикацию');
    }
    return canonicalChannelResult(parsed, 'instagram.com', [first], 'Instagram', first);
  }

  if (parsed.hostname === 'vk.com' || parsed.hostname === 'vkvideo.ru') {
    const contentRoute = /^(?:video|clip|wall|photo|story|market)(?:-?\d+(?:_|$)|[-_]|$)/i;
    const reservedRoute = /^(?:away|feed|im|login|search|share)$/i;
    if (!segments[0] || segments.length !== 1 || contentRoute.test(segments[0]) || reservedRoute.test(segments[0])) {
      throw new Error('Укажите ссылку на VK-сообщество или профиль, а не на публикацию');
    }
    return canonicalChannelResult(parsed, parsed.hostname, [first], 'VK', first);
  }

  throw new Error('Поддерживаются каналы YouTube, RuTube, VK, TikTok и Instagram');
}

const URL_MIGRATION_BATCH_SIZE = 25;

type UrlMigrationRow = { id: number; url: string; normalizedUrl: string; status: VideoStatus };
type UrlOwner = { id: number; status: VideoStatus };
type DashboardVideoRow = UrlMigrationRow & Record<string, unknown>;
type UrlAliasRow = { canonicalUrl: string; videoId: number };
type DashboardChannelRow = Record<string, unknown> & { id: number; isSyncing: number; creatorType: string; producerId: number };

function reconcileLegacyDuplicateStatuses(videos: DashboardVideoRow[], aliases: UrlAliasRow[]) {
  const videosById = new Map(videos.map((video) => [video.id, video]));
  const aliasOwners = new Map(aliases.map((alias) => [alias.canonicalUrl, alias.videoId]));
  const groups = new Map<string, DashboardVideoRow[]>();
  for (const video of videos) {
    try {
      const canonicalUrl = normalizeUrl(video.url);
      const group = groups.get(canonicalUrl) ?? [];
      group.push(video);
      groups.set(canonicalUrl, group);
    } catch {
      // Invalid legacy URLs are excluded from canonical duplicate reconciliation.
    }
  }

  const virtualErrors = new Set<number>();
  for (const [canonicalUrl, group] of groups) {
    const active = group.filter((video) => video.status === 'active');
    if (active.length < 2) continue;
    const aliasOwner = videosById.get(aliasOwners.get(canonicalUrl) ?? -1);
    const owner = aliasOwner?.status === 'active' && active.some((video) => video.id === aliasOwner.id)
      ? aliasOwner
      : active.find((video) => video.normalizedUrl === canonicalUrl) ?? active.reduce((lowest, video) => video.id < lowest.id ? video : lowest);
    for (const video of active) if (video.id !== owner.id) virtualErrors.add(video.id);
  }

  return videos.map((video) => virtualErrors.has(video.id) ? { ...video, status: 'error' as const } : video);
}

async function migrateUrlKeys(binding: D1Database) {
  const cursorMeta = await binding.prepare("SELECT value FROM app_meta WHERE key = 'url_migration_cursor'").first<{ value: string }>();
  const cursor = Number(cursorMeta?.value ?? 0) || 0;
  const page = await binding.prepare(`SELECT id, url, normalized_url AS normalizedUrl, status
    FROM videos WHERE id > ? ORDER BY id LIMIT ?`).bind(cursor, URL_MIGRATION_BATCH_SIZE).all<UrlMigrationRow>();
  const rows = page.results;

  if (rows.length === 0) {
    await binding.batch([
      binding.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('seed_version', '4')"),
      binding.prepare("DELETE FROM app_meta WHERE key = 'url_migration_cursor'"),
    ]);
    return;
  }

  const canonicalById = new Map<number, string>();
  for (const row of rows) {
    try {
      canonicalById.set(row.id, normalizeUrl(row.url));
    } catch {
      // A malformed legacy URL remains visible, but cannot block migration of valid rows.
    }
  }

  const canonicalUrls = [...new Set(canonicalById.values())];
  const normalizedOwners = new Map<string, UrlOwner>();
  const aliasOwners = new Map<string, UrlOwner>();
  if (canonicalUrls.length > 0) {
    const placeholders = canonicalUrls.map(() => '?').join(', ');
    const existing = await binding.prepare(`SELECT id, normalized_url AS normalizedUrl, status
      FROM videos WHERE normalized_url IN (${placeholders})`).bind(...canonicalUrls).all<{ id: number; normalizedUrl: string; status: VideoStatus }>();
    for (const row of existing.results) normalizedOwners.set(row.normalizedUrl, { id: row.id, status: row.status });
    const aliases = await binding.prepare(`SELECT a.canonical_url AS canonicalUrl, a.video_id AS videoId, v.status
      FROM video_url_aliases a JOIN videos v ON v.id = a.video_id
      WHERE a.canonical_url IN (${placeholders})`).bind(...canonicalUrls).all<{ canonicalUrl: string; videoId: number; status: VideoStatus }>();
    for (const row of aliases.results) aliasOwners.set(row.canonicalUrl, { id: row.videoId, status: row.status });
  }

  const operations: D1PreparedStatement[] = [];
  for (const canonicalUrl of canonicalUrls) {
    const normalizedOwner = normalizedOwners.get(canonicalUrl);
    const currentAliasOwner = aliasOwners.get(canonicalUrl);
    const matchingRows = rows.filter((row) => canonicalById.get(row.id) === canonicalUrl);
    const activeRow = matchingRows.find((row) => row.status === 'active');
    const firstMatchingRow = matchingRows[0];
    const owner = currentAliasOwner?.status === 'active'
      ? currentAliasOwner
      : normalizedOwner?.status === 'active'
        ? normalizedOwner
        : activeRow
          ? { id: activeRow.id, status: activeRow.status }
          : currentAliasOwner ?? normalizedOwner ?? (firstMatchingRow ? { id: firstMatchingRow.id, status: firstMatchingRow.status } : undefined);
    if (!owner) continue;

    if (currentAliasOwner?.id !== owner.id) {
      operations.push(binding.prepare(`INSERT INTO video_url_aliases (canonical_url, video_id) VALUES (?, ?)
        ON CONFLICT(canonical_url) DO UPDATE SET video_id = excluded.video_id`).bind(canonicalUrl, owner.id));
    }

    const ownerRow = rows.find((row) => row.id === owner.id);
    if (!normalizedOwner && ownerRow && ownerRow.normalizedUrl !== canonicalUrl) {
      operations.push(binding.prepare('UPDATE videos SET normalized_url = ? WHERE id = ? AND normalized_url = ?').bind(canonicalUrl, ownerRow.id, ownerRow.normalizedUrl));
      normalizedOwners.set(canonicalUrl, { id: ownerRow.id, status: ownerRow.status });
    }
    if (owner.status === 'active') {
      for (const row of matchingRows) {
        if (row.id !== owner.id && row.status === 'active') {
          operations.push(binding.prepare("UPDATE videos SET status = 'error' WHERE id = ? AND status = 'active'").bind(row.id));
        }
      }
    }
  }

  const lastId = rows.at(-1)!.id;
  operations.push(binding.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('url_migration_cursor', ?)").bind(String(lastId)));
  if (rows.length < URL_MIGRATION_BATCH_SIZE) {
    operations.push(binding.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('seed_version', '4')"));
    operations.push(binding.prepare("DELETE FROM app_meta WHERE key = 'url_migration_cursor'"));
  }
  await binding.batch(operations);
}

async function enforceYouTubeRetention(binding: D1Database) {
  const now = new Date();
  const nowIso = now.toISOString();
  const sweepDay = nowIso.slice(0, 10);
  const marker = await binding.prepare("SELECT value FROM app_meta WHERE key = 'youtube_retention_sweep_day'")
    .first<{ value: string }>();
  if (marker?.value === sweepDay) return;

  // The sweep runs once per UTC day, so the one-day buffer keeps retained data
  // below the 30-day ceiling even immediately before the next sweep.
  const cutoff = new Date(now.getTime() - YOUTUBE_HISTORY_RETENTION_MS + YOUTUBE_RETENTION_SWEEP_BUFFER_MS).toISOString();
  await binding.batch([
    binding.prepare(`DELETE FROM channel_sync_history
      WHERE recorded_at < ? AND channel_id IN (
        SELECT ch.id FROM creator_channels ch
        JOIN platforms pf ON pf.id = ch.platform_id
        WHERE pf.name = 'YouTube' COLLATE NOCASE
      )`).bind(cutoff),
    binding.prepare(`UPDATE creator_channels SET
      title = NULL, avatar_url = NULL, followers = NULL, total_views = NULL,
      total_likes = NULL,
      publication_count = NULL, reach_30d = NULL, metrics_updated_at = NULL,
      sync_source = NULL,
      sync_status = CASE WHEN sync_status = 'success' THEN 'pending' ELSE sync_status END,
      next_sync_at = CASE
        WHEN status = 'active' AND (next_sync_at IS NULL OR next_sync_at > ?) THEN ?
        ELSE next_sync_at
      END,
      updated_at = ?
      WHERE metrics_updated_at < ? AND platform_id IN (
        SELECT id FROM platforms WHERE name = 'YouTube' COLLATE NOCASE
      )`).bind(nowIso, nowIso, nowIso, cutoff),
    binding.prepare(`INSERT INTO app_meta (key, value) VALUES ('youtube_retention_sweep_day', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(sweepDay),
  ]);
}

export async function ensureDatabase() {
  const binding = db();
  // Schema changes are applied once by versioned Drizzle migrations, never per request.

  const seeded = await binding.prepare("SELECT value FROM app_meta WHERE key = 'seed_version'").first<{ value: string }>();
  if (!seeded) {
    const operations: D1PreparedStatement[] = [];
    for (const [id, name, domains] of platformsSeed) {
      operations.push(binding.prepare('INSERT OR IGNORE INTO platforms (id, name, domains, status) VALUES (?, ?, ?, ?)').bind(id, name, JSON.stringify(domains), 'active'));
    }
    const videoCount = await binding.prepare('SELECT COUNT(*) AS count FROM videos').first<{ count: number }>();
    operations.push(binding.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('seed_version', ?)").bind(videoCount?.count ? '2' : '4'));
    if (videoCount?.count) operations.push(binding.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('url_migration_cursor', '0')"));
    await binding.batch(operations);
    await binding.prepare('PRAGMA optimize').run();
  } else if (seeded.value === '1') {
    const cleanup: D1PreparedStatement[] = [];
    for (const [id, creatorId, platformId, url, publishedAt, reach, status] of videosSeed) {
      const creator = creatorsSeed.find(([creatorSeedId]) => creatorSeedId === creatorId)!;
      const addedAt = `${publishedAt}T12:00:00.000Z`;
      cleanup.push(binding.prepare(`DELETE FROM reach_history WHERE video_id = ? AND reach = ? AND recorded_at = ?
        AND NOT EXISTS (SELECT 1 FROM reach_history WHERE video_id = ? AND (reach != ? OR recorded_at != ?))
        AND EXISTS (SELECT 1 FROM videos WHERE id = ? AND creator_id = ? AND platform_id = ? AND url = ?
          AND published_at = ? AND added_at = ? AND reach = ? AND status = ?
          AND creator_type_snapshot = ? AND producer_id_snapshot = ?)`)
        .bind(id, reach, addedAt, id, reach, addedAt, id, creatorId, platformId, url, publishedAt, addedAt, reach, status, creator[2], creator[3]));
      cleanup.push(binding.prepare(`DELETE FROM videos WHERE id = ? AND creator_id = ? AND platform_id = ? AND url = ?
        AND published_at = ? AND added_at = ? AND reach = ? AND status = ?
        AND creator_type_snapshot = ? AND producer_id_snapshot = ?
        AND NOT EXISTS (SELECT 1 FROM reach_history WHERE video_id = ?)`)
        .bind(id, creatorId, platformId, url, publishedAt, addedAt, reach, status, creator[2], creator[3], id));
    }
    for (const [id, name, type, producerId] of creatorsSeed) {
      cleanup.push(binding.prepare(`DELETE FROM creators WHERE id = ? AND name = ? AND type = ? AND producer_id = ?
        AND status = 'active' AND created_at = '2026-08-25T09:00:00.000Z'
        AND NOT EXISTS (SELECT 1 FROM videos WHERE creator_id = ?)`)
        .bind(id, name, type, producerId, id));
    }
    for (const [id, name, status, createdAt] of producersSeed) {
      cleanup.push(binding.prepare(`DELETE FROM producers WHERE id = ? AND name = ? AND status = ? AND created_at = ?
        AND NOT EXISTS (SELECT 1 FROM creators WHERE producer_id = ?)`)
        .bind(id, name, status, createdAt, id));
    }
    cleanup.push(binding.prepare("UPDATE app_meta SET value = '2' WHERE key = 'seed_version'"));
    cleanup.push(binding.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('url_migration_cursor', '0')"));
    await binding.batch(cleanup);
    await binding.prepare('PRAGMA optimize').run();
  } else if (seeded.value === '3') {
    await binding.batch([
      binding.prepare('DELETE FROM video_url_aliases'),
      binding.prepare("UPDATE app_meta SET value = '2' WHERE key = 'seed_version'"),
      binding.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('url_migration_cursor', '0')"),
    ]);
  }

  const currentVersion = await binding.prepare("SELECT value FROM app_meta WHERE key = 'seed_version'").first<{ value: string }>();
  if (currentVersion?.value === '2') await migrateUrlKeys(binding);
  await enforceYouTubeRetention(binding);
}

export async function getDashboardData() {
  await ensureDatabase();
  const binding = db();
  const now = new Date().toISOString();
  const [producers, creators, platforms, channels, videos, urlAliases] = await Promise.all([
    binding.prepare('SELECT id, name, status, created_at AS createdAt FROM producers ORDER BY name COLLATE NOCASE').all(),
    binding.prepare(`SELECT c.id, c.name, c.type, c.producer_id AS producerId, p.name AS producerName,
      c.status, c.created_at AS createdAt
      FROM creators c JOIN producers p ON p.id = c.producer_id
      ORDER BY c.name COLLATE NOCASE`).all(),
    binding.prepare('SELECT id, name, domains, status FROM platforms ORDER BY id').all(),
    binding.prepare(`SELECT ch.id, ch.creator_id AS creatorId, c.name AS creatorName, c.type AS creatorType,
      c.producer_id AS producerId, p.name AS producerName, ch.platform_id AS platformId,
      (SELECT telegram_user_id FROM telegram_creator_links WHERE creator_id = c.id ORDER BY type_confirmed_at DESC, created_at LIMIT 1) AS creatorTelegramId,
      (SELECT username FROM telegram_creator_links WHERE creator_id = c.id ORDER BY type_confirmed_at DESC, created_at LIMIT 1) AS creatorTelegramUsername,
      (SELECT telegram_user_id FROM telegram_producer_links WHERE producer_id = p.id) AS producerTelegramId,
      (SELECT a.username FROM telegram_accounts a JOIN telegram_producer_links l ON l.telegram_user_id = a.telegram_user_id WHERE l.producer_id = p.id) AS producerTelegramUsername,
      pf.name AS platformName, ch.url, ch.normalized_url AS normalizedUrl,
      ch.provider_channel_id AS providerChannelId, ch.handle, ch.title, ch.avatar_url AS avatarUrl,
      ch.followers, ch.total_views AS totalViews, ch.publication_count AS publicationCount,
      ch.total_likes AS totalLikes, ch.total_likes_override AS totalLikesOverride,
      COALESCE(ch.total_likes_override, ch.total_likes) AS effectiveTotalLikes,
      ch.reach_30d AS reach30d, ch.followers_override AS followersOverride,
      ch.total_views_override AS totalViewsOverride,
      ch.publication_count_override AS publicationCountOverride,
      ch.reach_30d_override AS reach30dOverride,
      COALESCE(ch.followers_override, ch.followers) AS effectiveFollowers,
      COALESCE(ch.total_views_override, ch.total_views) AS effectiveTotalViews,
      COALESCE(ch.publication_count_override, ch.publication_count) AS effectivePublicationCount,
      COALESCE(ch.reach_30d_override, ch.reach_30d) AS effectiveReach30d,
      ch.status, ch.sync_status AS syncStatus,
      CASE WHEN ch.lease_until > ? THEN 'syncing' ELSE ch.sync_status END AS lastSyncStatus,
      ch.sync_error AS syncError, ch.sync_error AS lastSyncError,
      ch.sync_source AS syncSource, ch.sync_source AS parserSource,
      ch.last_synced_at AS lastSyncedAt, ch.last_synced_at AS lastAttemptAt,
      ch.metrics_updated_at AS metricsUpdatedAt, ch.metrics_updated_at AS lastSyncAt,
      ch.next_sync_at AS nextSyncAt,
      ch.lease_until AS leaseUntil, ch.consecutive_failures AS consecutiveFailures,
      CASE WHEN ch.lease_until > ? THEN 1 ELSE 0 END AS isSyncing,
      ch.created_at AS createdAt, ch.updated_at AS updatedAt
      FROM creator_channels ch
      JOIN creators c ON c.id = ch.creator_id
      JOIN producers p ON p.id = c.producer_id
      JOIN platforms pf ON pf.id = ch.platform_id
      WHERE ch.deleted_at IS NULL
      ORDER BY c.name COLLATE NOCASE, pf.id, ch.id`).bind(now, now).all<DashboardChannelRow>(),
    binding.prepare(`SELECT v.id, v.creator_id AS creatorId, c.name AS creatorName, c.type AS creatorType,
      c.producer_id AS producerId, p.name AS producerName, v.platform_id AS platformId,
      pf.name AS platformName, v.url, v.normalized_url AS normalizedUrl,
      v.published_at AS publishedAt, v.added_at AS addedAt, v.reach, v.status,
      v.creator_type_snapshot AS creatorTypeSnapshot, v.producer_id_snapshot AS producerIdSnapshot
      FROM videos v
      JOIN creators c ON c.id = v.creator_id
      JOIN producers p ON p.id = c.producer_id
      JOIN platforms pf ON pf.id = v.platform_id
      ORDER BY v.published_at DESC, v.id DESC`).all<DashboardVideoRow>(),
    binding.prepare('SELECT canonical_url AS canonicalUrl, video_id AS videoId FROM video_url_aliases').all<UrlAliasRow>(),
  ]);

  return {
    producers: producers.results,
    creators: creators.results,
    platforms: platforms.results.map((platform) => ({
      ...platform,
      domains: JSON.parse(String(platform.domains)) as string[],
    })),
    channels: channels.results.map((channel) => ({ ...channel, isSyncing: Boolean(channel.isSyncing) })),
    videos: reconcileLegacyDuplicateStatuses(videos.results, urlAliases.results),
  };
}

function cleanName(value: unknown, label: string) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 2 || name.length > 80) throw new Error(`${label}: от 2 до 80 символов`);
  return name;
}

function integerId(value: unknown, label: string) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`Некорректное поле «${label}»`);
  }
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`Некорректное поле «${label}»`);
  return id;
}

function validateStatus(value: unknown): Status {
  if (value !== 'active' && value !== 'inactive') throw new Error('Некорректный статус');
  return value;
}

function validateCreatorType(value: unknown): CreatorType {
  if (value !== 'UGC' && value !== 'AI') throw new Error('Тип должен быть UGC или AI');
  return value;
}

function validateVideoStatus(value: unknown): VideoStatus {
  if (value !== 'active' && value !== 'deleted' && value !== 'error') throw new Error('Некорректный статус ролика');
  return value;
}

export class ChannelStorageError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'ChannelStorageError';
  }
}

function hasOwn(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function optionalCorrection(input: Record<string, unknown>, key: string, label: string) {
  if (!hasOwn(input, key)) return undefined;
  const raw = input[key];
  if (raw === null || (typeof raw === 'string' && raw.trim() === '')) return null;
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    throw new Error(`${label} должен быть целым неотрицательным числом`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} должен быть целым неотрицательным числом`);
  return value;
}

function deriveCreatorName(channel: NormalizedChannelUrl) {
  const pathIdentity = new URL(channel.normalizedUrl).pathname.split('/').filter(Boolean).at(-1) ?? '';
  const identity = (channel.inferredHandle ?? pathIdentity).replace(/^@/, '').trim();
  const suffix = ` · ${channel.platformName}`;
  const availableIdentityLength = 80 - suffix.length;
  const candidate = identity.length >= 2
    ? `${identity.slice(0, availableIdentityLength)}${suffix}`
    : `Канал ${channel.platformName}`;
  return cleanName(candidate, 'Имя креатора');
}

async function channelPlatform(binding: D1Database, platformName: SupportedPlatformName) {
  const platform = await binding.prepare('SELECT id, name, status FROM platforms WHERE name = ? COLLATE NOCASE')
    .bind(platformName).first<{ id: number; name: string; status: Status }>();
  if (!platform || platform.status !== 'active') throw new Error(`Площадка ${platformName} недоступна`);
  return platform;
}

export async function createProducer(input: Record<string, unknown>) {
  await ensureDatabase();
  const result = await db().prepare('INSERT INTO producers (name, status, created_at) VALUES (?, ?, ?)')
    .bind(cleanName(input.name, 'Имя продюсера'), validateStatus(input.status ?? 'active'), new Date().toISOString()).run();
  return result.meta.last_row_id;
}

export async function updateProducer(input: Record<string, unknown>) {
  await ensureDatabase();
  const id = integerId(input.id, 'Продюсер');
  const result = await db().prepare('UPDATE producers SET name = ?, status = ? WHERE id = ?')
    .bind(cleanName(input.name, 'Имя продюсера'), validateStatus(input.status), id).run();
  if (!result.meta.changes) throw new Error('Продюсер не найден');
  return id;
}

async function activeProducer(producerId: number) {
  const producer = await db().prepare('SELECT id, status FROM producers WHERE id = ?').bind(producerId).first<{ id: number; status: Status }>();
  if (!producer) throw new Error('Продюсер не найден');
  return producer;
}

export async function createCreator(input: Record<string, unknown>) {
  await ensureDatabase();
  const producerId = integerId(input.producerId, 'Продюсер');
  const producer = await activeProducer(producerId);
  if (producer.status !== 'active') throw new Error('Нельзя назначить неактивного продюсера');
  const result = await db().prepare('INSERT INTO creators (name, type, producer_id, status, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(cleanName(input.name, 'Имя креатора'), validateCreatorType(input.type), producerId, validateStatus(input.status ?? 'active'), new Date().toISOString()).run();
  return result.meta.last_row_id;
}

export async function updateCreator(input: Record<string, unknown>) {
  await ensureDatabase();
  const id = integerId(input.id, 'Креатор');
  const producerId = integerId(input.producerId, 'Продюсер');
  const current = await db().prepare('SELECT producer_id AS producerId FROM creators WHERE id = ?').bind(id).first<{ producerId: number }>();
  if (!current) throw new Error('Креатор не найден');
  if (producerId !== current.producerId) {
    const producer = await activeProducer(producerId);
    if (producer.status !== 'active') throw new Error('Нельзя назначить неактивного продюсера');
  }
  await db().prepare('UPDATE creators SET name = ?, type = ?, producer_id = ?, status = ? WHERE id = ?')
    .bind(cleanName(input.name, 'Имя креатора'), validateCreatorType(input.type), producerId, validateStatus(input.status), id).run();
  return id;
}

export async function createChannel(input: Record<string, unknown>) {
  await ensureDatabase();
  const binding = db();
  const ready = await binding.prepare(`SELECT c.id FROM creators c
    JOIN producers p ON p.id = c.producer_id
    JOIN telegram_producer_links pl ON pl.producer_id = p.id
    JOIN telegram_creator_links cl ON cl.creator_id = c.id
    WHERE c.id = ? AND c.status = 'active' AND p.status = 'active' AND cl.type_confirmed_at IS NOT NULL`)
    .bind(Number(input.creatorId) || 0).first();
  if (!ready) throw new Error('Сначала зарегистрируйте креатора через Telegram: приглашение продюсера → ИИ / UGC → канал');
  const channel = normalizeChannelUrl(input.url);
  const platform = await channelPlatform(binding, channel.platformName);
  const status = validateStatus(input.status ?? 'active');
  const now = new Date().toISOString();
  const nextSyncAt = status === 'active' ? now : null;
  const hasCreatorId = input.creatorId !== undefined && input.creatorId !== null && input.creatorId !== '';
  const hasNewCreatorFields = ['newCreatorName', 'newCreatorType', 'newCreatorProducerId'].some((key) => hasOwn(input, key));

  if (hasCreatorId && hasNewCreatorFields) throw new Error('Выберите существующего креатора или создайте нового');

  if (hasCreatorId) {
    const creatorId = integerId(input.creatorId, 'Креатор');
    const creator = await binding.prepare('SELECT id, status FROM creators WHERE id = ?').bind(creatorId).first<{ id: number; status: Status }>();
    if (!creator) throw new Error('Креатор не найден');
    if (creator.status !== 'active') throw new Error('Нельзя добавить канал неактивному креатору');
    const result = await binding.prepare(`INSERT INTO creator_channels
      (creator_id, platform_id, url, normalized_url, handle, status, sync_status,
       next_sync_at, consecutive_failures, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?)`).bind(
        creatorId,
        platform.id,
        channel.normalizedUrl,
        channel.normalizedUrl,
        channel.inferredHandle,
        status,
        nextSyncAt,
        now,
        now,
      ).run();
    return Number(result.meta.last_row_id);
  }

  if (!hasNewCreatorFields) throw new Error('Выберите креатора или укажите данные нового');
  const producerId = integerId(input.newCreatorProducerId, 'Продюсер');
  const producer = await activeProducer(producerId);
  if (producer.status !== 'active') throw new Error('Нельзя назначить неактивного продюсера');
  const type = validateCreatorType(input.newCreatorType);
  const requestedName = typeof input.newCreatorName === 'string' ? input.newCreatorName.trim() : '';
  const name = requestedName ? cleanName(requestedName, 'Имя креатора') : deriveCreatorName(channel);
  const results = await binding.batch([
    binding.prepare(`INSERT INTO creators (name, type, producer_id, status, created_at)
      VALUES (?, ?, ?, 'active', ?)`).bind(name, type, producerId, now),
    binding.prepare(`INSERT INTO creator_channels
      (creator_id, platform_id, url, normalized_url, handle, status, sync_status,
       next_sync_at, consecutive_failures, created_at, updated_at)
      SELECT id, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ? FROM creators WHERE name = ?`)
      .bind(platform.id, channel.normalizedUrl, channel.normalizedUrl, channel.inferredHandle, status, nextSyncAt, now, now, name),
  ]);
  const id = Number(results[1]?.meta.last_row_id ?? 0);
  if (id > 0) return id;
  const created = await binding.prepare('SELECT id FROM creator_channels WHERE normalized_url = ?')
    .bind(channel.normalizedUrl).first<{ id: number }>();
  if (!created) throw new Error('Не удалось создать канал');
  return created.id;
}

type SqlValue = string | number | null;

function archiveChannelStatement(binding: D1Database, id: number, now: string, ownerId: number | null) {
  return binding.prepare(`UPDATE creator_channels SET deleted_at = ?, status = 'inactive',
    normalized_url = 'deleted:' || id || ':' || normalized_url, provider_channel_id = NULL,
    next_sync_at = NULL, lease_token = NULL, lease_until = NULL, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL AND (? IS NULL OR creator_id = ?)`)
    .bind(now, now, id, ownerId, ownerId);
}

export async function deleteChannel(input: Record<string, unknown>, ownerId: number | null = null) {
  await ensureDatabase();
  const id = integerId(input.id, 'Канал');
  const existing = await db().prepare('SELECT id, deleted_at AS deletedAt FROM creator_channels WHERE id = ? AND (? IS NULL OR creator_id = ?)')
    .bind(id, ownerId, ownerId).first<{ id: number; deletedAt: string | null }>();
  if (!existing) throw new ChannelStorageError('Канал не найден', 404);
  if (!existing.deletedAt) await archiveChannelStatement(db(), id, new Date().toISOString(), ownerId).run();
  return id;
}

export async function updateChannel(input: Record<string, unknown>, ownerId: number | null = null) {
  await ensureDatabase();
  const binding = db();
  const id = integerId(input.id, 'Канал');
  const existing = await binding.prepare(`SELECT id, status, creator_id AS creatorId, normalized_url AS normalizedUrl FROM creator_channels
    WHERE id = ? AND deleted_at IS NULL AND (? IS NULL OR creator_id = ?)`)
    .bind(id, ownerId, ownerId).first<{ id: number; status: Status; creatorId: number; normalizedUrl: string }>();
  if (!existing) throw new ChannelStorageError('Канал не найден', 404);
  const now = new Date().toISOString();
  if (hasOwn(input, 'url')) {
    const replacement = normalizeChannelUrl(input.url);
    if (replacement.normalizedUrl !== existing.normalizedUrl) {
      const platform = await channelPlatform(binding, replacement.platformName);
      const status = validateStatus(input.status ?? existing.status);
      // A different address starts its own history. Keep the old record and its
      // Telegram receipts archived so retries cannot resurrect deleted links.
      const results = await binding.batch([
        binding.prepare(`INSERT INTO creator_channels
          (creator_id, platform_id, url, normalized_url, handle, status, sync_status, next_sync_at, consecutive_failures, created_at, updated_at)
          SELECT creator_id, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ? FROM creator_channels
          WHERE id = ? AND normalized_url = ? AND deleted_at IS NULL AND (? IS NULL OR creator_id = ?)`)
          .bind(platform.id, replacement.normalizedUrl, replacement.normalizedUrl, replacement.inferredHandle,
            status, status === 'active' ? now : null, now, now, id, existing.normalizedUrl, ownerId, ownerId),
        archiveChannelStatement(binding, id, now, ownerId),
      ]);
      if (!results[0]?.meta.changes) throw new ChannelStorageError('Канал уже изменён. Откройте список заново', 409);
      return Number(results[0].meta.last_row_id);
    }
  }
  const changes = new Map<string, SqlValue>();
  if (hasOwn(input, 'status')) {
    const status = validateStatus(input.status);
    changes.set('status', status);
    if (status !== existing.status) changes.set('next_sync_at', status === 'active' ? now : null);
    if (status === 'inactive' && status !== existing.status) {
      changes.set('lease_until', null);
      changes.set('lease_token', null);
    }
  }

  const correctionColumns = [
    ['followersOverride', 'followers_override', 'Коррекция подписчиков'],
    ['totalViewsOverride', 'total_views_override', 'Коррекция просмотров'],
    ['totalLikesOverride', 'total_likes_override', 'Коррекция лайков'],
    ['publicationCountOverride', 'publication_count_override', 'Коррекция публикаций'],
    ['reach30dOverride', 'reach_30d_override', 'Коррекция охвата за 30 дней'],
  ] as const;
  for (const [inputKey, column, label] of correctionColumns) {
    const value = optionalCorrection(input, inputKey, label);
    if (value !== undefined) changes.set(column, value);
  }

  changes.set('updated_at', now);
  const assignments = [...changes.keys()].map((column) => `${column} = ?`).join(', ');
  const result = await binding.prepare(`UPDATE creator_channels SET ${assignments} WHERE id = ? AND deleted_at IS NULL AND (? IS NULL OR creator_id = ?)`)
    .bind(...changes.values(), id, ownerId, ownerId).run();
  if (!result.meta.changes) throw new ChannelStorageError('Канал не найден', 404);
  return id;
}

const CHANNEL_LEASE_MS = 15 * 60_000;
const CHANNEL_SUCCESS_INTERVAL_MS = 24 * 60 * 60_000;
const CHANNEL_FAILURE_MAX_INTERVAL_MS = 6 * 60 * 60_000;
const YOUTUBE_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60_000;
const YOUTUBE_RETENTION_SWEEP_BUFFER_MS = 24 * 60 * 60_000;
const NEEDS_AUTH_RETRY_MS = 24 * 60 * 60_000;

function optionalSyncText(
  input: Record<string, unknown>,
  key: string,
  label: string,
  maxLength: number,
): string | null {
  if (!hasOwn(input, key) || input[key] === null || input[key] === '') return null;
  if (typeof input[key] !== 'string') throw new Error(`Поле «${label}» должно быть строкой`);
  const value = input[key].trim();
  if (!value) return null;
  if (value.length > maxLength) throw new Error(`Поле «${label}» не должно быть длиннее ${maxLength} символов`);
  return value;
}

function requiredSyncText(input: Record<string, unknown>, key: string, label: string, maxLength: number) {
  const value = optionalSyncText(input, key, label, maxLength);
  if (!value) throw new Error(`Укажите поле «${label}»`);
  return value;
}

function optionalSyncMetric(input: Record<string, unknown>, key: string, label: string) {
  if (!hasOwn(input, key)) return null;
  if (input[key] === null || (typeof input[key] === 'string' && input[key].trim() === '')) {
    return null;
  }
  if (typeof input[key] !== 'number' && typeof input[key] !== 'string') {
    throw new Error(`${label} должно быть целым неотрицательным числом`);
  }
  const value = Number(input[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} должно быть целым неотрицательным числом`);
  return value;
}

function optionalAvatarUrl(input: Record<string, unknown>) {
  const avatar = optionalSyncText(input, 'avatarUrl', 'Аватар', 2048);
  if (!avatar) return null;
  let parsed: URL;
  try {
    parsed = new URL(avatar);
  } catch {
    throw new Error('Аватар должен быть корректной URL-ссылкой');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Аватар должен быть HTTP(S)-ссылкой');
  return avatar;
}

function observationTime(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Укажите observedAt');
  const timestamp = Date.parse(value);
  const now = Date.now();
  if (!Number.isFinite(timestamp) || timestamp < Date.UTC(2000, 0, 1) || timestamp > now + 10 * 60_000) {
    throw new Error('observedAt должен быть корректной датой не позже текущего времени');
  }
  return new Date(timestamp).toISOString();
}

type ChannelSyncState = {
  id: number;
  providerChannelId: string | null;
  lastSyncedAt: string | null;
  leaseUntil: string | null;
  leaseToken: string | null;
  consecutiveFailures: number;
};

async function channelSyncState(binding: D1Database, channelId: number) {
  const state = await binding.prepare(`SELECT id, provider_channel_id AS providerChannelId,
    last_synced_at AS lastSyncedAt, lease_until AS leaseUntil, lease_token AS leaseToken,
    consecutive_failures AS consecutiveFailures FROM creator_channels WHERE id = ?`)
    .bind(channelId).first<ChannelSyncState>();
  if (!state) throw new ChannelStorageError('Канал не найден', 404);
  return state;
}

function ensureFreshObservation(state: ChannelSyncState, observedAt: string) {
  if (!state.lastSyncedAt) return false;
  if (state.lastSyncedAt === observedAt) return true;
  if (state.lastSyncedAt > observedAt) throw new ChannelStorageError('Получены устаревшие данные синхронизации', 409);
  return false;
}

function ensureLeaseOwnership(state: ChannelSyncState, leaseToken: string, nowIso: string) {
  if (state.leaseToken !== leaseToken || !state.leaseUntil || state.leaseUntil <= nowIso) {
    throw new ChannelStorageError('Аренда канала истекла; получите новое задание', 409);
  }
}

async function syncRaceResult(binding: D1Database, channelId: number, observedAt: string) {
  const state = await channelSyncState(binding, channelId);
  if (state.lastSyncedAt === observedAt) return { id: channelId, duplicate: true };
  if (!state.lastSyncedAt || state.lastSyncedAt < observedAt) {
    throw new ChannelStorageError('Аренда канала истекла; получите новое задание', 409);
  }
  throw new ChannelStorageError('Получены устаревшие данные синхронизации', 409);
}

export async function claimDueChannels(limitValue: unknown = 1) {
  await ensureDatabase();
  const requestedLimit = limitValue ?? 1;
  if (typeof requestedLimit !== 'number' || !Number.isInteger(requestedLimit)
    || requestedLimit < 1 || requestedLimit > 25) {
    throw new Error('limit должен быть целым числом от 1 до 25');
  }
  const binding = db();
  const now = new Date();
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + CHANNEL_LEASE_MS).toISOString();
  const leaseToken = crypto.randomUUID();
  await binding.prepare(`UPDATE creator_channels SET lease_until = ?, lease_token = ?, updated_at = ?
    WHERE id IN (
      SELECT ch.id FROM creator_channels ch
      JOIN creators c ON c.id = ch.creator_id
      JOIN producers p ON p.id = c.producer_id
      JOIN platforms pf ON pf.id = ch.platform_id
      WHERE ch.status = 'active' AND c.status = 'active' AND p.status = 'active' AND pf.status = 'active'
        AND (ch.next_sync_at IS NULL OR ch.next_sync_at <= ?)
        AND (ch.lease_until IS NULL OR ch.lease_until <= ?)
      ORDER BY COALESCE(ch.next_sync_at, ch.created_at), ch.id
      LIMIT ?
    )`).bind(leaseUntil, leaseToken, nowIso, nowIso, nowIso, requestedLimit).run();
  const claimed = await binding.prepare(`SELECT ch.id, ch.url, ch.normalized_url AS normalizedUrl,
    ch.provider_channel_id AS providerChannelId, ch.handle, ch.title, ch.avatar_url AS avatarUrl,
    ch.last_synced_at AS lastSyncedAt, ch.metrics_updated_at AS metricsUpdatedAt,
    ch.next_sync_at AS nextSyncAt, ch.lease_until AS leaseUntil, ch.lease_token AS leaseToken,
    ch.consecutive_failures AS consecutiveFailures, pf.name AS platformName,
    c.id AS creatorId, c.name AS creatorName, c.type AS creatorType,
    c.producer_id AS producerId
    FROM creator_channels ch
    JOIN platforms pf ON pf.id = ch.platform_id
    JOIN creators c ON c.id = ch.creator_id
    WHERE ch.lease_token = ? ORDER BY ch.id`).bind(leaseToken).all();
  return claimed.results;
}

export async function completeChannelSync(input: Record<string, unknown>) {
  await ensureDatabase();
  const binding = db();
  const channelId = integerId(input.channelId, 'Канал');
  const observedAt = observationTime(input.observedAt);
  const leaseToken = requiredSyncText(input, 'leaseToken', 'Токен аренды', 128);
  const requestAcceptedAt = new Date().toISOString();
  const state = await channelSyncState(binding, channelId);
  if (ensureFreshObservation(state, observedAt)) return { id: channelId, duplicate: true };
  ensureLeaseOwnership(state, leaseToken, requestAcceptedAt);

  const parserSource = requiredSyncText(input, 'parserSource', 'Источник синхронизации', 120);
  const providerChannelId = optionalSyncText(input, 'providerChannelId', 'ID канала у провайдера', 256);
  if (state.providerChannelId && providerChannelId
    && providerChannelId !== state.providerChannelId) {
    throw new ChannelStorageError('ID канала у провайдера не совпадает с ранее определённым', 409);
  }
  const stableProviderChannelId = state.providerChannelId ?? providerChannelId;
  const handle = optionalSyncText(input, 'handle', 'Хэндл', 256);
  const title = optionalSyncText(input, 'title', 'Название канала', 300);
  const avatarUrl = optionalAvatarUrl(input);
  const followers = optionalSyncMetric(input, 'followers', 'Подписчики');
  const totalViews = optionalSyncMetric(input, 'totalViews', 'Просмотры');
  const totalLikes = optionalSyncMetric(input, 'totalLikes', 'Лайки');
  const publicationCount = optionalSyncMetric(input, 'publicationCount', 'Публикации');
  const reach30d = optionalSyncMetric(input, 'reach30d', 'Охват за 30 дней');
  if ([followers, totalViews, totalLikes, publicationCount, reach30d].every((value) => value === null)) {
    throw new ChannelStorageError('Площадка не предоставила ни одной метрики канала', 422);
  }
  const now = new Date();
  const recordedAt = now.toISOString();
  const nextSyncAt = new Date(now.getTime() + CHANNEL_SUCCESS_INTERVAL_MS).toISOString();
  const youtubeHistoryCutoff = new Date(now.getTime() - YOUTUBE_HISTORY_RETENTION_MS).toISOString();
  const results = await binding.batch([
    binding.prepare(`INSERT INTO channel_sync_history
      (channel_id, status, observed_at, recorded_at, source, error_message,
       provider_channel_id, handle, title, avatar_url, followers, total_views,
       publication_count, reach_30d, total_likes, creator_type_snapshot, producer_id_snapshot)
      SELECT ch.id, 'success', ?, ?, ?, NULL,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        c.type, c.producer_id
      FROM creator_channels ch JOIN creators c ON c.id = ch.creator_id
      WHERE ch.id = ? AND (ch.last_synced_at IS NULL OR ch.last_synced_at < ?)
        AND ch.lease_token = ? AND ch.lease_until > ?`)
      .bind(observedAt, recordedAt, parserSource, stableProviderChannelId,
        handle, title, avatarUrl, followers, totalViews, publicationCount, reach30d, totalLikes,
        channelId, observedAt, leaseToken, recordedAt),
    binding.prepare(`UPDATE creator_channels SET
      provider_channel_id = ?, handle = COALESCE(?, handle), title = COALESCE(?, title), avatar_url = COALESCE(?, avatar_url),
      followers = ?, total_views = ?, publication_count = ?, reach_30d = ?, total_likes = ?,
      sync_status = 'success', sync_error = NULL, sync_source = ?, last_synced_at = ?,
      metrics_updated_at = ?, next_sync_at = CASE WHEN status = 'active' THEN ? ELSE NULL END,
      lease_until = NULL, lease_token = NULL, consecutive_failures = 0, updated_at = ?
      WHERE id = ? AND (last_synced_at IS NULL OR last_synced_at < ?)
        AND lease_token = ? AND lease_until > ?`)
      .bind(stableProviderChannelId, handle, title, avatarUrl,
        followers, totalViews, publicationCount, reach30d, totalLikes,
        parserSource, observedAt, observedAt, nextSyncAt,
        recordedAt, channelId, observedAt, leaseToken, recordedAt),
    binding.prepare(`DELETE FROM channel_sync_history
      WHERE channel_id = ? AND recorded_at < ?
        AND EXISTS (
          SELECT 1 FROM creator_channels ch
          JOIN platforms pf ON pf.id = ch.platform_id
          WHERE ch.id = ? AND ch.last_synced_at = ?
            AND pf.name = 'YouTube' COLLATE NOCASE
        )`).bind(channelId, youtubeHistoryCutoff, channelId, observedAt),
  ]);
  if (!results[1]?.meta.changes) return syncRaceResult(binding, channelId, observedAt);
  return { id: channelId, duplicate: false };
}

function failureRetryAt(status: ChannelSyncFailureStatus, failureCount: number, now: Date) {
  if (status === 'needs_auth') return new Date(now.getTime() + NEEDS_AUTH_RETRY_MS).toISOString();
  const exponent = Math.min(Math.max(failureCount - 1, 0), 5);
  const delayMs = Math.min(15 * 60_000 * (2 ** exponent), CHANNEL_FAILURE_MAX_INTERVAL_MS);
  return new Date(now.getTime() + delayMs).toISOString();
}

export async function failChannelSync(input: Record<string, unknown>) {
  await ensureDatabase();
  const binding = db();
  const channelId = integerId(input.channelId, 'Канал');
  const observedAt = observationTime(input.observedAt);
  const leaseToken = requiredSyncText(input, 'leaseToken', 'Токен аренды', 128);
  const requestAcceptedAt = new Date().toISOString();
  const state = await channelSyncState(binding, channelId);
  if (ensureFreshObservation(state, observedAt)) return { id: channelId, duplicate: true };
  ensureLeaseOwnership(state, leaseToken, requestAcceptedAt);

  const errorMessage = requiredSyncText(input, 'error', 'Ошибка синхронизации', 1000);
  const parserSource = optionalSyncText(input, 'parserSource', 'Источник синхронизации', 120);
  const status: ChannelSyncFailureStatus = input.status === undefined ? 'error'
    : input.status === 'error' || input.status === 'needs_auth' ? input.status
      : (() => { throw new Error('Статус ошибки должен быть error или needs_auth'); })();
  const now = new Date();
  const recordedAt = now.toISOString();
  const nextSyncAt = failureRetryAt(status, state.consecutiveFailures + 1, now);
  const results = await binding.batch([
    binding.prepare(`INSERT INTO channel_sync_history
      (channel_id, status, observed_at, recorded_at, source, error_message,
       creator_type_snapshot, producer_id_snapshot)
      SELECT ch.id, ?, ?, ?, ?, ?, c.type, c.producer_id
      FROM creator_channels ch JOIN creators c ON c.id = ch.creator_id
      WHERE ch.id = ? AND (ch.last_synced_at IS NULL OR ch.last_synced_at < ?)
        AND ch.lease_token = ? AND ch.lease_until > ?`)
      .bind(status, observedAt, recordedAt, parserSource, errorMessage,
        channelId, observedAt, leaseToken, recordedAt),
    binding.prepare(`UPDATE creator_channels SET sync_status = ?, sync_error = ?,
      last_synced_at = ?,
      next_sync_at = CASE WHEN status = 'active' THEN ? ELSE NULL END,
      lease_until = NULL, lease_token = NULL, consecutive_failures = consecutive_failures + 1,
      updated_at = ? WHERE id = ? AND (last_synced_at IS NULL OR last_synced_at < ?)
        AND lease_token = ? AND lease_until > ?`)
      .bind(status, errorMessage, observedAt, nextSyncAt, recordedAt,
        channelId, observedAt, leaseToken, recordedAt),
  ]);
  if (!results[1]?.meta.changes) return syncRaceResult(binding, channelId, observedAt);
  return { id: channelId, duplicate: false };
}

function videoValues(input: Record<string, unknown>) {
  const reach = Number(input.reach);
  if (!Number.isInteger(reach) || reach < 0) throw new Error('Охват должен быть целым неотрицательным числом');
  const publishedAt = typeof input.publishedAt === 'string' ? input.publishedAt : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) throw new Error('Укажите дату публикации');
  return {
    creatorId: integerId(input.creatorId, 'Креатор'),
    platformId: integerId(input.platformId, 'Площадка'),
    url: typeof input.url === 'string' ? input.url.trim() : '',
    normalizedUrl: normalizeUrl(typeof input.url === 'string' ? input.url : ''),
    publishedAt,
    reach,
    status: validateVideoStatus(input.status ?? 'active'),
  };
}

async function findVideoByCanonical(canonicalUrl: string, excludeVideoId?: number) {
  const binding = db();
  const exact = await binding.prepare('SELECT id FROM videos WHERE normalized_url = ? AND id != ? ORDER BY id LIMIT 1')
    .bind(canonicalUrl, excludeVideoId ?? 0).first<{ id: number }>();
  if (exact) return exact.id;

  let cursor = 0;
  while (true) {
    const page = await binding.prepare('SELECT id, url FROM videos WHERE id > ? ORDER BY id LIMIT 250')
      .bind(cursor).all<{ id: number; url: string }>();
    if (page.results.length === 0) return null;
    for (const video of page.results) {
      if (video.id === excludeVideoId) continue;
      try {
        if (normalizeUrl(video.url) === canonicalUrl) return video.id;
      } catch {
        // Ignore malformed legacy URLs while checking valid canonical keys.
      }
    }
    cursor = page.results.at(-1)!.id;
    if (page.results.length < 250) return null;
  }
}

async function findPreferredActiveOwner(canonicalUrl: string) {
  const binding = db();
  const normalizedOwner = await binding.prepare("SELECT id FROM videos WHERE normalized_url = ? AND status = 'active' ORDER BY id LIMIT 1")
    .bind(canonicalUrl).first<{ id: number }>();
  if (normalizedOwner) return normalizedOwner.id;

  let cursor = 0;
  while (true) {
    const page = await binding.prepare("SELECT id, url FROM videos WHERE id > ? AND status = 'active' ORDER BY id LIMIT 250")
      .bind(cursor).all<{ id: number; url: string }>();
    if (page.results.length === 0) return null;
    for (const video of page.results) {
      try {
        if (normalizeUrl(video.url) === canonicalUrl) return video.id;
      } catch {
        // Ignore malformed legacy URLs while selecting a canonical owner.
      }
    }
    cursor = page.results.at(-1)!.id;
    if (page.results.length < 250) return null;
  }
}

async function assertVideoUrlAvailable(canonicalUrl: string, excludeVideoId?: number) {
  const binding = db();
  const owner = await binding.prepare('SELECT video_id AS videoId FROM video_url_aliases WHERE canonical_url = ?')
    .bind(canonicalUrl).first<{ videoId: number }>();
  if (owner && owner.videoId !== excludeVideoId) throw new Error('Этот ролик уже добавлен');
  if (owner) return;

  const version = await binding.prepare("SELECT value FROM app_meta WHERE key = 'seed_version'").first<{ value: string }>();
  if (version?.value === '4') return;
  if (await findVideoByCanonical(canonicalUrl, excludeVideoId)) throw new Error('Этот ролик уже добавлен');
}

export async function createVideo(input: Record<string, unknown>) {
  await ensureDatabase();
  const values = videoValues(input);
  await assertVideoUrlAvailable(values.normalizedUrl);
  const creator = await db().prepare('SELECT id, type, producer_id AS producerId, status FROM creators WHERE id = ?')
    .bind(values.creatorId).first<{ id: number; type: CreatorType; producerId: number; status: Status }>();
  if (!creator) throw new Error('Креатор не найден');
  if (creator.status !== 'active') throw new Error('Нельзя добавить ролик неактивному креатору');
  const platform = await db().prepare('SELECT id, status FROM platforms WHERE id = ?').bind(values.platformId).first<{ id: number; status: Status }>();
  if (!platform || platform.status !== 'active') throw new Error('Площадка недоступна');
  const now = new Date().toISOString();
  const binding = db();
  const [insert] = await binding.batch([
    binding.prepare(`INSERT INTO videos
      (creator_id, platform_id, url, normalized_url, published_at, added_at, reach, status, creator_type_snapshot, producer_id_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(values.creatorId, values.platformId, values.url, values.normalizedUrl, values.publishedAt, now, values.reach, values.status, creator.type, creator.producerId),
    binding.prepare('INSERT INTO reach_history (video_id, reach, recorded_at) SELECT id, ?, ? FROM videos WHERE normalized_url = ?').bind(values.reach, now, values.normalizedUrl),
    binding.prepare('INSERT INTO video_url_aliases (canonical_url, video_id) SELECT ?, id FROM videos WHERE normalized_url = ?').bind(values.normalizedUrl, values.normalizedUrl),
  ]);
  const id = Number(insert.meta.last_row_id);
  return id;
}

export async function updateVideo(input: Record<string, unknown>) {
  await ensureDatabase();
  const id = integerId(input.id, 'Ролик');
  const values = videoValues(input);
  const existing = await db().prepare(`SELECT creator_id AS creatorId, url, normalized_url AS normalizedUrl, reach,
    creator_type_snapshot AS creatorTypeSnapshot, producer_id_snapshot AS producerIdSnapshot
    FROM videos WHERE id = ?`).bind(id).first<{ creatorId: number; url: string; normalizedUrl: string; reach: number; creatorTypeSnapshot: CreatorType; producerIdSnapshot: number }>();
  if (!existing) throw new Error('Ролик не найден');
  let previousCanonicalUrl: string | null = null;
  let canonicalUnchanged = false;
  try {
    previousCanonicalUrl = normalizeUrl(existing.url);
    canonicalUnchanged = previousCanonicalUrl === values.normalizedUrl;
  } catch {
    // A corrected URL for a malformed legacy record is treated as a new canonical URL.
  }
  const previousAliasOwner = previousCanonicalUrl
    ? await db().prepare('SELECT video_id AS videoId FROM video_url_aliases WHERE canonical_url = ?').bind(previousCanonicalUrl).first<{ videoId: number }>()
    : null;
  if (canonicalUnchanged && values.status === 'active') {
    if (previousAliasOwner && previousAliasOwner.videoId !== id) throw new Error('Этот ролик уже добавлен');
    if (!previousAliasOwner && previousCanonicalUrl) {
      const preferredOwnerId = await findPreferredActiveOwner(previousCanonicalUrl);
      if (preferredOwnerId && preferredOwnerId !== id) throw new Error('Этот ролик уже добавлен');
    }
  }
  if (!canonicalUnchanged) await assertVideoUrlAvailable(values.normalizedUrl, id);
  const replacementOwnerId = previousCanonicalUrl && !canonicalUnchanged && (!previousAliasOwner || previousAliasOwner.videoId === id)
    ? await findVideoByCanonical(previousCanonicalUrl, id)
    : null;
  const creator = await db().prepare('SELECT id, type, producer_id AS producerId, status FROM creators WHERE id = ?')
    .bind(values.creatorId).first<{ id: number; type: CreatorType; producerId: number; status: Status }>();
  if (!creator) throw new Error('Креатор не найден');
  if (values.creatorId !== existing.creatorId && creator.status !== 'active') throw new Error('Нельзя назначить неактивного креатора');
  const platform = await db().prepare('SELECT id, status FROM platforms WHERE id = ?').bind(values.platformId).first<{ id: number; status: Status }>();
  if (!platform || platform.status !== 'active') throw new Error('Площадка недоступна');
  const creatorTypeSnapshot = values.creatorId === existing.creatorId ? existing.creatorTypeSnapshot : creator.type;
  const producerIdSnapshot = values.creatorId === existing.creatorId ? existing.producerIdSnapshot : creator.producerId;
  const storedNormalizedUrl = canonicalUnchanged ? existing.normalizedUrl : values.normalizedUrl;
  const update = db().prepare(`UPDATE videos SET creator_id = ?, platform_id = ?, url = ?, normalized_url = ?,
    published_at = ?, reach = ?, status = ?, creator_type_snapshot = ?, producer_id_snapshot = ? WHERE id = ?`)
    .bind(values.creatorId, values.platformId, values.url, storedNormalizedUrl, values.publishedAt, values.reach, values.status, creatorTypeSnapshot, producerIdSnapshot, id);
  const binding = db();
  const operations = [
    binding.prepare('INSERT OR IGNORE INTO video_url_aliases (canonical_url, video_id) VALUES (?, ?)').bind(values.normalizedUrl, id),
    update,
  ];
  if (previousCanonicalUrl && !canonicalUnchanged && (!previousAliasOwner || previousAliasOwner.videoId === id)) {
    if (replacementOwnerId) {
      operations.push(
        previousAliasOwner
          ? binding.prepare('UPDATE video_url_aliases SET video_id = ? WHERE canonical_url = ? AND video_id = ?').bind(replacementOwnerId, previousCanonicalUrl, id)
          : binding.prepare('INSERT OR IGNORE INTO video_url_aliases (canonical_url, video_id) VALUES (?, ?)').bind(previousCanonicalUrl, replacementOwnerId),
        binding.prepare('UPDATE videos SET normalized_url = ? WHERE id = ? AND normalized_url != ?').bind(previousCanonicalUrl, replacementOwnerId, previousCanonicalUrl),
      );
    } else if (previousAliasOwner?.videoId === id) {
      operations.push(binding.prepare('DELETE FROM video_url_aliases WHERE canonical_url = ? AND video_id = ?').bind(previousCanonicalUrl, id));
    }
  }
  if (existing.reach !== values.reach) operations.push(
    binding.prepare('INSERT INTO reach_history (video_id, reach, recorded_at) VALUES (?, ?, ?)').bind(id, values.reach, new Date().toISOString()),
  );
  await binding.batch(operations);
  return id;
}
