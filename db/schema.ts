import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const producers = sqliteTable(
  'producers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('idx_producers_name').on(table.name)],
);

export const platforms = sqliteTable(
  'platforms',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    domains: text('domains', { mode: 'json' }).$type<string[]>().notNull(),
    status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
  },
  (table) => [uniqueIndex('idx_platforms_name').on(table.name)],
);

export const creators = sqliteTable(
  'creators',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    type: text('type', { enum: ['UGC', 'AI'] }).notNull(),
    producerId: integer('producer_id')
      .notNull()
      .references(() => producers.id),
    status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_creators_name').on(table.name),
    index('idx_creators_producer_id').on(table.producerId),
  ],
);

export const videos = sqliteTable(
  'videos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    creatorId: integer('creator_id')
      .notNull()
      .references(() => creators.id),
    platformId: integer('platform_id')
      .notNull()
      .references(() => platforms.id),
    url: text('url').notNull(),
    normalizedUrl: text('normalized_url').notNull(),
    publishedAt: text('published_at').notNull(),
    addedAt: text('added_at').notNull(),
    reach: integer('reach').notNull().default(0),
    status: text('status', { enum: ['active', 'deleted', 'error'] }).notNull().default('active'),
    creatorTypeSnapshot: text('creator_type_snapshot', { enum: ['UGC', 'AI'] }).notNull(),
    producerIdSnapshot: integer('producer_id_snapshot').notNull(),
  },
  (table) => [
    uniqueIndex('idx_videos_normalized_url').on(table.normalizedUrl),
    index('idx_videos_creator_id').on(table.creatorId),
    index('idx_videos_platform_id').on(table.platformId),
    index('idx_videos_status_published_at').on(table.status, table.publishedAt),
  ],
);

export const videoUrlAliases = sqliteTable(
  'video_url_aliases',
  {
    canonicalUrl: text('canonical_url').primaryKey(),
    videoId: integer('video_id')
      .notNull()
      .references(() => videos.id),
  },
  (table) => [index('idx_video_url_aliases_video_id').on(table.videoId)],
);

export const reachHistory = sqliteTable(
  'reach_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    videoId: integer('video_id')
      .notNull()
      .references(() => videos.id),
    reach: integer('reach').notNull(),
    recordedAt: text('recorded_at').notNull(),
  },
  (table) => [index('idx_reach_history_video_id').on(table.videoId)],
);
