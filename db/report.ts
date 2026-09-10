import { env } from 'cloudflare:workers';
import { getDashboardData } from '@/db/storage';
import { validateReportPeriod, periodMetrics, type ReportSnapshot } from '@/lib/report-period';

export async function getPeriodReport(from: string, to: string) {
  const period = validateReportPeriod(from, to);
  const data = await getDashboardData();
  const history = await env.DB.prepare(`SELECT h.channel_id AS channelId, h.observed_at AS observedAt,
    h.total_views AS totalViews, h.publication_count AS publicationCount, h.total_likes AS totalLikes,
    h.followers, h.source, h.creator_type_snapshot AS creatorType, h.producer_id_snapshot AS producerId
    FROM channel_sync_history h WHERE h.id IN (
      SELECT (SELECT id FROM channel_sync_history WHERE channel_id = ch.id AND status = 'success'
        AND observed_at <= ? ORDER BY observed_at DESC, id DESC LIMIT 1) FROM creator_channels ch
      UNION
      SELECT (SELECT id FROM channel_sync_history WHERE channel_id = ch.id AND status = 'success'
        AND observed_at < ? ORDER BY observed_at DESC, id DESC LIMIT 1) FROM creator_channels ch
    )`).bind(period.start, period.effectiveEnd).all<ReportSnapshot & { channelId: number }>();
  return { ...data, period: { from, to }, channels: data.channels.map((channel) => {
    const snapshots = history.results.filter((row) => row.channelId === channel.id).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const baseline = snapshots.filter((s) => s.observedAt <= period.start).at(-1) ?? null;
    const ending = snapshots.filter((s) => s.observedAt < period.effectiveEnd).at(-1) ?? null;
    const metrics = periodMetrics(baseline, ending, period, { creatorType: String(channel.creatorType), producerId: Number(channel.producerId) });
    return { ...channel, ...metrics, reach30d: null,
      followersOverride: null, totalViewsOverride: null, publicationCountOverride: null, totalLikesOverride: null, reach30dOverride: null,
      effectiveFollowers: metrics.followers, effectiveTotalViews: metrics.totalViews,
      effectivePublicationCount: metrics.publicationCount, effectiveTotalLikes: metrics.totalLikes, effectiveReach30d: null,
      lastSyncAt: ending?.observedAt ?? null };
  }) };
}
