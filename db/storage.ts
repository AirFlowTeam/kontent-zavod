import { env } from 'cloudflare:workers';

type Status = 'active' | 'inactive';
type VideoStatus = 'active' | 'deleted' | 'error';
type CreatorType = 'UGC' | 'AI';

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS producers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_producers_name ON producers (name)`,
  `CREATE TABLE IF NOT EXISTS platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    domains TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_platforms_name ON platforms (name)`,
  `CREATE TABLE IF NOT EXISTS creators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('UGC', 'AI')),
    producer_id INTEGER NOT NULL REFERENCES producers(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_creators_name ON creators (name)`,
  `CREATE INDEX IF NOT EXISTS idx_creators_producer_id ON creators (producer_id)`,
  `CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL REFERENCES creators(id),
    platform_id INTEGER NOT NULL REFERENCES platforms(id),
    url TEXT NOT NULL,
    normalized_url TEXT NOT NULL,
    published_at TEXT NOT NULL,
    added_at TEXT NOT NULL,
    reach INTEGER NOT NULL DEFAULT 0 CHECK (reach >= 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted', 'error')),
    creator_type_snapshot TEXT NOT NULL CHECK (creator_type_snapshot IN ('UGC', 'AI')),
    producer_id_snapshot INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_normalized_url ON videos (normalized_url)`,
  `CREATE INDEX IF NOT EXISTS idx_videos_creator_id ON videos (creator_id)`,
  `CREATE INDEX IF NOT EXISTS idx_videos_platform_id ON videos (platform_id)`,
  `CREATE INDEX IF NOT EXISTS idx_videos_status_published_at ON videos (status, published_at)`,
  `CREATE TABLE IF NOT EXISTS video_url_aliases (
    canonical_url TEXT PRIMARY KEY NOT NULL,
    video_id INTEGER NOT NULL REFERENCES videos(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_video_url_aliases_video_id ON video_url_aliases (video_id)`,
  `CREATE TABLE IF NOT EXISTS reach_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id),
    reach INTEGER NOT NULL CHECK (reach >= 0),
    recorded_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reach_history_video_id ON reach_history (video_id)`,
];

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

const URL_MIGRATION_BATCH_SIZE = 25;

type UrlMigrationRow = { id: number; url: string; normalizedUrl: string; status: VideoStatus };
type UrlOwner = { id: number; status: VideoStatus };
type DashboardVideoRow = UrlMigrationRow & Record<string, unknown>;
type UrlAliasRow = { canonicalUrl: string; videoId: number };

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

export async function ensureDatabase() {
  const binding = db();
  await binding.batch(schemaStatements.map((statement) => binding.prepare(statement)));

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
}

export async function getDashboardData() {
  await ensureDatabase();
  const binding = db();
  const [producers, creators, platforms, videos, urlAliases] = await Promise.all([
    binding.prepare('SELECT id, name, status, created_at AS createdAt FROM producers ORDER BY name COLLATE NOCASE').all(),
    binding.prepare(`SELECT c.id, c.name, c.type, c.producer_id AS producerId, p.name AS producerName,
      c.status, c.created_at AS createdAt
      FROM creators c JOIN producers p ON p.id = c.producer_id
      ORDER BY c.name COLLATE NOCASE`).all(),
    binding.prepare('SELECT id, name, domains, status FROM platforms ORDER BY id').all(),
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
    videos: reconcileLegacyDuplicateStatuses(videos.results, urlAliases.results),
  };
}

function cleanName(value: unknown, label: string) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 2 || name.length > 80) throw new Error(`${label}: от 2 до 80 символов`);
  return name;
}

function integerId(value: unknown, label: string) {
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
