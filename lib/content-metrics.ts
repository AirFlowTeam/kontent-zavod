import type {
  Channel,
  ChannelEffectiveMetrics,
  Creator,
  Metrics,
  Platform,
  Producer,
  SummaryRow,
} from '@/lib/content-types';

export const numberFormatter = new Intl.NumberFormat('ru-RU');

export function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function nullableMetricValue(...values: Array<number | null | undefined>) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value))
      return Math.max(0, Math.round(value));
  }
  return null;
}

export function effectiveChannelMetrics(
  channel: Channel,
): ChannelEffectiveMetrics {
  return {
    followers: nullableMetricValue(
      channel.effectiveFollowers,
      channel.followersOverride,
      channel.followers,
    ),
    totalViews: nullableMetricValue(
      channel.effectiveTotalViews,
      channel.totalViewsOverride,
      channel.totalViews,
    ),
    publicationCount: nullableMetricValue(
      channel.effectivePublicationCount,
      channel.publicationCountOverride,
      channel.publicationCount,
    ),
    reach30d: nullableMetricValue(
      channel.effectiveReach30d,
      channel.reach30dOverride,
      channel.reach30d,
    ),
  };
}

export function makeMetrics(channels: Channel[]): Metrics {
  const creatorIds = new Set<number>();
  const totals: Metrics = {
    creatorCount: 0,
    channelCount: 0,
    followers: 0,
    followersCount: 0,
    totalViews: 0,
    totalViewsCount: 0,
    publicationCount: 0,
    publicationCountCount: 0,
    reach30d: 0,
    reach30dCount: 0,
  };

  for (const channel of channels) {
    const metrics = effectiveChannelMetrics(channel);
    creatorIds.add(channel.creatorId);
    totals.channelCount += 1;
    if (metrics.followers !== null) {
      totals.followers += metrics.followers;
      totals.followersCount += 1;
    }
    if (metrics.totalViews !== null) {
      totals.totalViews += metrics.totalViews;
      totals.totalViewsCount += 1;
    }
    if (metrics.publicationCount !== null) {
      totals.publicationCount += metrics.publicationCount;
      totals.publicationCountCount += 1;
    }
    if (metrics.reach30d !== null) {
      totals.reach30d += metrics.reach30d;
      totals.reach30dCount += 1;
    }
  }
  totals.creatorCount = creatorIds.size;
  return totals;
}

function summaryMetrics(channels: Channel[]) {
  const metrics = makeMetrics(channels);
  return {
    channelCount: metrics.channelCount,
    followers: metrics.followers,
    followersCount: metrics.followersCount,
    totalViews: metrics.totalViews,
    totalViewsCount: metrics.totalViewsCount,
    publicationCount: metrics.publicationCount,
    publicationCountCount: metrics.publicationCountCount,
    reach30d: metrics.reach30d,
    reach30dCount: metrics.reach30dCount,
  };
}

export function buildCreatorRows(
  channels: Channel[],
  creators: Creator[],
  includeEmpty = false,
): SummaryRow[] {
  return creators
    .map((creator) => ({
      id: creator.id,
      name: creator.name,
      type: creator.type,
      producerName: creator.producerName,
      ...summaryMetrics(
        channels.filter((channel) => channel.creatorId === creator.id),
      ),
    }))
    .filter((row) => includeEmpty || row.channelCount > 0)
    .sort(
      (a, b) =>
        b.totalViews - a.totalViews ||
        b.followers - a.followers ||
        a.name.localeCompare(b.name, 'ru'),
    );
}

export function buildProducerRows(
  channels: Channel[],
  producers: Producer[],
  includeEmpty = false,
): SummaryRow[] {
  return producers
    .map((producer) => {
      const matching = channels.filter(
        (channel) => channel.producerId === producer.id,
      );
      return {
        id: producer.id,
        name: producer.name,
        creatorCount: new Set(matching.map((channel) => channel.creatorId))
          .size,
        ...summaryMetrics(matching),
      };
    })
    .filter((row) => includeEmpty || row.channelCount > 0)
    .sort(
      (a, b) =>
        b.totalViews - a.totalViews ||
        b.followers - a.followers ||
        a.name.localeCompare(b.name, 'ru'),
    );
}

export function detectPlatformId(urlValue: string, platforms: Platform[]) {
  try {
    const hostname = new URL(urlValue).hostname
      .toLowerCase()
      .replace(/^(www\.|m\.)/, '');
    return (
      platforms.find((platform) =>
        platform.domains.some(
          (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
        ),
      )?.id ?? null
    );
  } catch {
    return null;
  }
}

export function formatDateTime(value: string | null) {
  if (!value) return 'Никогда';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Никогда';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export type Freshness = 'never' | 'fresh' | 'aging' | 'stale';

export function getFreshness(
  value: string | null,
  now = Date.now(),
): Freshness {
  if (!value) return 'never';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'never';
  const age = Math.max(0, now - timestamp);
  if (age < 24 * 60 * 60 * 1000) return 'fresh';
  if (age < 72 * 60 * 60 * 1000) return 'aging';
  return 'stale';
}

export function formatRelativeSync(value: string | null, now = Date.now()) {
  if (!value) return 'не синхронизировался';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'не синхронизировался';
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000));
  if (minutes < 2) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.round(hours / 24)} дн. назад`;
}
