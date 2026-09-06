import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

export const creatorChannels = sqliteTable(
  'creator_channels',
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
    providerChannelId: text('provider_channel_id'),
    handle: text('handle'),
    title: text('title'),
    avatarUrl: text('avatar_url'),
    followers: integer('followers'),
    totalViews: integer('total_views'),
    publicationCount: integer('publication_count'),
    reach30d: integer('reach_30d'),
    followersOverride: integer('followers_override'),
    totalViewsOverride: integer('total_views_override'),
    publicationCountOverride: integer('publication_count_override'),
    reach30dOverride: integer('reach_30d_override'),
    status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
    syncStatus: text('sync_status', { enum: ['pending', 'success', 'error', 'needs_auth'] }).notNull().default('pending'),
    syncError: text('sync_error'),
    syncSource: text('sync_source'),
    lastSyncedAt: text('last_synced_at'),
    metricsUpdatedAt: text('metrics_updated_at'),
    nextSyncAt: text('next_sync_at'),
    leaseUntil: text('lease_until'),
    leaseToken: text('lease_token'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_creator_channels_normalized_url').on(table.normalizedUrl),
    uniqueIndex('idx_creator_channels_provider_id').on(table.platformId, table.providerChannelId),
    index('idx_creator_channels_creator_id').on(table.creatorId),
    index('idx_creator_channels_platform_id').on(table.platformId),
    index('idx_creator_channels_due').on(table.status, table.nextSyncAt, table.leaseUntil),
    index('idx_creator_channels_lease_token').on(table.leaseToken),
    check('chk_creator_channels_status', sql`${table.status} IN ('active', 'inactive')`),
    check('chk_creator_channels_sync_status', sql`${table.syncStatus} IN ('pending', 'success', 'error', 'needs_auth')`),
    check('chk_creator_channels_followers', sql`${table.followers} IS NULL OR ${table.followers} >= 0`),
    check('chk_creator_channels_total_views', sql`${table.totalViews} IS NULL OR ${table.totalViews} >= 0`),
    check('chk_creator_channels_publication_count', sql`${table.publicationCount} IS NULL OR ${table.publicationCount} >= 0`),
    check('chk_creator_channels_reach_30d', sql`${table.reach30d} IS NULL OR ${table.reach30d} >= 0`),
    check('chk_creator_channels_followers_override', sql`${table.followersOverride} IS NULL OR ${table.followersOverride} >= 0`),
    check('chk_creator_channels_total_views_override', sql`${table.totalViewsOverride} IS NULL OR ${table.totalViewsOverride} >= 0`),
    check('chk_creator_channels_publication_count_override', sql`${table.publicationCountOverride} IS NULL OR ${table.publicationCountOverride} >= 0`),
    check('chk_creator_channels_reach_30d_override', sql`${table.reach30dOverride} IS NULL OR ${table.reach30dOverride} >= 0`),
    check('chk_creator_channels_failure_count', sql`${table.consecutiveFailures} >= 0`),
  ],
);

export const channelSyncHistory = sqliteTable(
  'channel_sync_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    channelId: integer('channel_id')
      .notNull()
      .references(() => creatorChannels.id),
    status: text('status', { enum: ['success', 'error', 'needs_auth'] }).notNull(),
    observedAt: text('observed_at').notNull(),
    recordedAt: text('recorded_at').notNull(),
    source: text('source'),
    errorMessage: text('error_message'),
    providerChannelId: text('provider_channel_id'),
    handle: text('handle'),
    title: text('title'),
    avatarUrl: text('avatar_url'),
    followers: integer('followers'),
    totalViews: integer('total_views'),
    publicationCount: integer('publication_count'),
    reach30d: integer('reach_30d'),
    creatorTypeSnapshot: text('creator_type_snapshot', { enum: ['UGC', 'AI'] }).notNull(),
    producerIdSnapshot: integer('producer_id_snapshot').notNull(),
  },
  (table) => [
    uniqueIndex('idx_channel_sync_history_observation').on(table.channelId, table.observedAt),
    index('idx_channel_sync_history_channel_recorded').on(table.channelId, table.recordedAt),
    index('idx_channel_sync_history_status_recorded').on(table.status, table.recordedAt),
    check('chk_channel_sync_history_status', sql`${table.status} IN ('success', 'error', 'needs_auth')`),
    check('chk_channel_sync_history_followers', sql`${table.followers} IS NULL OR ${table.followers} >= 0`),
    check('chk_channel_sync_history_total_views', sql`${table.totalViews} IS NULL OR ${table.totalViews} >= 0`),
    check('chk_channel_sync_history_publication_count', sql`${table.publicationCount} IS NULL OR ${table.publicationCount} >= 0`),
    check('chk_channel_sync_history_reach_30d', sql`${table.reach30d} IS NULL OR ${table.reach30d} >= 0`),
  ],
);
