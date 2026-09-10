export type RecordStatus = 'active' | 'inactive';
export type CreatorType = 'UGC' | 'AI';
export type ChannelSyncStatus =
  | 'pending'
  | 'syncing'
  | 'success'
  | 'error'
  | 'needs_auth';

export interface Producer {
  id: number;
  name: string;
  status: RecordStatus;
  createdAt: string;
}

export interface Platform {
  id: number;
  name: string;
  domains: string[];
  status: RecordStatus;
}

export interface Creator {
  id: number;
  name: string;
  type: CreatorType;
  producerId: number;
  producerName: string;
  status: RecordStatus;
  createdAt: string;
}

export interface Channel {
  periodData?: import('@/lib/report-period').ChannelPeriod;
  id: number;
  creatorId: number;
  creatorName: string;
  creatorType: CreatorType;
  producerId: number;
  producerName: string;
  creatorTelegramId: string | null;
  creatorTelegramUsername: string | null;
  producerTelegramId: string | null;
  producerTelegramUsername: string | null;
  platformId: number;
  platformName: string;
  url: string;
  normalizedUrl: string;
  providerChannelId: string | null;
  handle: string | null;
  title: string | null;
  avatarUrl: string | null;
  status: RecordStatus;
  followers: number | null;
  totalViews: number | null;
  totalLikes: number | null;
  publicationCount: number | null;
  reach30d: number | null;
  followersOverride: number | null;
  totalViewsOverride: number | null;
  totalLikesOverride: number | null;
  publicationCountOverride: number | null;
  reach30dOverride: number | null;
  effectiveFollowers: number | null;
  effectiveTotalViews: number | null;
  effectiveTotalLikes: number | null;
  effectivePublicationCount: number | null;
  effectiveReach30d: number | null;
  lastSyncAt: string | null;
  lastSyncStatus: ChannelSyncStatus | null;
  lastSyncError: string | null;
  parserSource: string | null;
  nextSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardData {
  producers: Producer[];
  creators: Creator[];
  platforms: Platform[];
  channels: Channel[];
}

export interface ChannelEffectiveMetrics {
  followers: number | null;
  totalViews: number | null;
  totalLikes: number | null;
  publicationCount: number | null;
  reach30d: number | null;
}

export interface SummaryRow {
  id: number;
  name: string;
  type?: CreatorType;
  producerName?: string;
  creatorCount?: number;
  channelCount: number;
  followers: number;
  followersCount: number;
  totalViews: number;
  totalViewsCount: number;
  totalLikes: number;
  totalLikesCount: number;
  publicationCount: number;
  publicationCountCount: number;
  reach30d: number;
  reach30dCount: number;
}

export interface Metrics {
  creatorCount: number;
  channelCount: number;
  followers: number;
  followersCount: number;
  totalViews: number;
  totalViewsCount: number;
  totalLikes: number;
  totalLikesCount: number;
  publicationCount: number;
  publicationCountCount: number;
  reach30d: number;
  reach30dCount: number;
}
