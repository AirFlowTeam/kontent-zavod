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
  const tracking = ['fbclid', 'gclid', 'igshid', 'si', 'share_id'];
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (key.toLowerCase().startsWith('utm_') || tracking.includes(key.toLowerCase())) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString();
}

export async function ensureDatabase() {
  const binding = db();
  await binding.batch(schemaStatements.map((statement) => binding.prepare(statement)));

  const seeded = await binding.prepare("SELECT value FROM app_meta WHERE key = 'seed_version'").first<{ value: string }>();
  if (!seeded) {
    const operations: D1PreparedStatement[] = [];
    for (const [id, name, status, createdAt] of producersSeed) {
      operations.push(binding.prepare('INSERT OR IGNORE INTO producers (id, name, status, created_at) VALUES (?, ?, ?, ?)').bind(id, name, status, createdAt));
    }
    for (const [id, name, domains] of platformsSeed) {
      operations.push(binding.prepare('INSERT OR IGNORE INTO platforms (id, name, domains, status) VALUES (?, ?, ?, ?)').bind(id, name, JSON.stringify(domains), 'active'));
    }
    for (const [id, name, type, producerId] of creatorsSeed) {
      operations.push(binding.prepare('INSERT OR IGNORE INTO creators (id, name, type, producer_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, name, type, producerId, 'active', '2026-08-25T09:00:00.000Z'));
    }
    for (const [id, creatorId, platformId, url, publishedAt, reach, status] of videosSeed) {
      const creator = creatorsSeed.find(([creatorSeedId]) => creatorSeedId === creatorId)!;
      operations.push(
        binding.prepare(`INSERT OR IGNORE INTO videos
          (id, creator_id, platform_id, url, normalized_url, published_at, added_at, reach, status, creator_type_snapshot, producer_id_snapshot)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, creatorId, platformId, url, normalizeUrl(url), publishedAt, `${publishedAt}T12:00:00.000Z`, reach, status, creator[2], creator[3]),
      );
      operations.push(binding.prepare('INSERT INTO reach_history (video_id, reach, recorded_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM videos WHERE id = ?)').bind(id, reach, `${publishedAt}T12:00:00.000Z`, id));
    }
    operations.push(binding.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('seed_version', '1')"));
    await binding.batch(operations);
    await binding.prepare('PRAGMA optimize').run();
  }
}

export async function getDashboardData() {
  await ensureDatabase();
  const binding = db();
  const [producers, creators, platforms, videos] = await Promise.all([
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
      ORDER BY v.published_at DESC, v.id DESC`).all(),
  ]);

  return {
    producers: producers.results,
    creators: creators.results,
    platforms: platforms.results.map((platform) => ({
      ...platform,
      domains: JSON.parse(String(platform.domains)) as string[],
    })),
    videos: videos.results,
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

export async function createVideo(input: Record<string, unknown>) {
  await ensureDatabase();
  const values = videoValues(input);
  const creator = await db().prepare('SELECT id, type, producer_id AS producerId, status FROM creators WHERE id = ?')
    .bind(values.creatorId).first<{ id: number; type: CreatorType; producerId: number; status: Status }>();
  if (!creator) throw new Error('Креатор не найден');
  if (creator.status !== 'active') throw new Error('Нельзя добавить ролик неактивному креатору');
  const platform = await db().prepare('SELECT id, status FROM platforms WHERE id = ?').bind(values.platformId).first<{ id: number; status: Status }>();
  if (!platform || platform.status !== 'active') throw new Error('Площадка недоступна');
  const now = new Date().toISOString();
  const insert = await db().prepare(`INSERT INTO videos
    (creator_id, platform_id, url, normalized_url, published_at, added_at, reach, status, creator_type_snapshot, producer_id_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(values.creatorId, values.platformId, values.url, values.normalizedUrl, values.publishedAt, now, values.reach, values.status, creator.type, creator.producerId).run();
  const id = Number(insert.meta.last_row_id);
  await db().prepare('INSERT INTO reach_history (video_id, reach, recorded_at) VALUES (?, ?, ?)').bind(id, values.reach, now).run();
  return id;
}

export async function updateVideo(input: Record<string, unknown>) {
  await ensureDatabase();
  const id = integerId(input.id, 'Ролик');
  const values = videoValues(input);
  const existing = await db().prepare(`SELECT creator_id AS creatorId, reach,
    creator_type_snapshot AS creatorTypeSnapshot, producer_id_snapshot AS producerIdSnapshot
    FROM videos WHERE id = ?`).bind(id).first<{ creatorId: number; reach: number; creatorTypeSnapshot: CreatorType; producerIdSnapshot: number }>();
  if (!existing) throw new Error('Ролик не найден');
  const creator = await db().prepare('SELECT id, type, producer_id AS producerId, status FROM creators WHERE id = ?')
    .bind(values.creatorId).first<{ id: number; type: CreatorType; producerId: number; status: Status }>();
  if (!creator) throw new Error('Креатор не найден');
  if (values.creatorId !== existing.creatorId && creator.status !== 'active') throw new Error('Нельзя назначить неактивного креатора');
  const platform = await db().prepare('SELECT id, status FROM platforms WHERE id = ?').bind(values.platformId).first<{ id: number; status: Status }>();
  if (!platform || platform.status !== 'active') throw new Error('Площадка недоступна');
  const creatorTypeSnapshot = values.creatorId === existing.creatorId ? existing.creatorTypeSnapshot : creator.type;
  const producerIdSnapshot = values.creatorId === existing.creatorId ? existing.producerIdSnapshot : creator.producerId;
  await db().prepare(`UPDATE videos SET creator_id = ?, platform_id = ?, url = ?, normalized_url = ?,
    published_at = ?, reach = ?, status = ?, creator_type_snapshot = ?, producer_id_snapshot = ? WHERE id = ?`)
    .bind(values.creatorId, values.platformId, values.url, values.normalizedUrl, values.publishedAt, values.reach, values.status, creatorTypeSnapshot, producerIdSnapshot, id).run();
  if (existing.reach !== values.reach) {
    await db().prepare('INSERT INTO reach_history (video_id, reach, recorded_at) VALUES (?, ?, ?)').bind(id, values.reach, new Date().toISOString()).run();
  }
  return id;
}
