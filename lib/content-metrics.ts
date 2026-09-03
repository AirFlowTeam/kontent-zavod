import type { Creator, Metrics, Platform, Producer, SummaryRow, Video } from '@/lib/content-types';

export const numberFormatter = new Intl.NumberFormat('ru-RU');

export function formatNumber(value: number) {
  return numberFormatter.format(value);
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(`${value}T12:00:00`))
    .replace('.', '');
}

export function makeMetrics(videos: Video[]): Metrics {
  const reach = videos.reduce((sum, video) => sum + video.reach, 0);
  return {
    creatorCount: new Set(videos.map((video) => video.creatorId)).size,
    videoCount: videos.length,
    reach,
    average: videos.length ? Math.round(reach / videos.length) : 0,
  };
}

export function buildCreatorRows(videos: Video[], creators: Creator[], includeEmpty = false): SummaryRow[] {
  return creators
    .map((creator) => {
      const matching = videos.filter((video) => video.creatorId === creator.id);
      const reach = matching.reduce((sum, video) => sum + video.reach, 0);
      return {
        id: creator.id,
        name: creator.name,
        type: creator.type,
        producerName: creator.producerName,
        videoCount: matching.length,
        reach,
        average: matching.length ? Math.round(reach / matching.length) : 0,
      } satisfies SummaryRow;
    })
    .filter((row) => includeEmpty || row.videoCount > 0)
    .sort((a, b) => b.reach - a.reach || a.name.localeCompare(b.name, 'ru'));
}

export function buildProducerRows(videos: Video[], producers: Producer[], includeEmpty = false): SummaryRow[] {
  return producers
    .map((producer) => {
      const matching = videos.filter((video) => video.producerId === producer.id);
      const reach = matching.reduce((sum, video) => sum + video.reach, 0);
      return {
        id: producer.id,
        name: producer.name,
        creatorCount: new Set(matching.map((video) => video.creatorId)).size,
        videoCount: matching.length,
        reach,
        average: matching.length ? Math.round(reach / matching.length) : 0,
      } satisfies SummaryRow;
    })
    .filter((row) => includeEmpty || row.videoCount > 0)
    .sort((a, b) => b.reach - a.reach || a.name.localeCompare(b.name, 'ru'));
}

export function detectPlatformId(urlValue: string, platforms: Platform[]) {
  try {
    const hostname = new URL(urlValue).hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
    return platforms.find((platform) => platform.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)))?.id ?? null;
  } catch {
    return null;
  }
}

export function isoToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function currentMonthRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const localIso = (date: Date) => {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  };
  return {
    from: localIso(new Date(year, month, 1)),
    to: localIso(new Date(year, month + 1, 0)),
  };
}

export function periodLabel(from: string, to: string) {
  const format = (value: string) => value ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value}T12:00:00`)) : '…';
  return `${format(from)} — ${format(to)}`;
}
