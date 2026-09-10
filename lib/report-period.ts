export function moscowToday(now = new Date()) {
  return new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10);
}

export function validateReportPeriod(from: string, to: string, now = new Date()) {
  for (const value of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
      || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
      throw new Error('Укажите корректные даты начала и конца периода');
    }
  }
  if (from > to) throw new Error('Начало периода не может быть позже конца');
  if (to > moscowToday(now)) throw new Error('Выберите период не позже сегодняшнего дня');
  const start = new Date(`${from}T00:00:00+03:00`);
  const end = new Date(new Date(`${to}T00:00:00+03:00`).getTime() + 86400000);
  return { from, to, start: start.toISOString(), end: end.toISOString(),
    effectiveEnd: new Date(Math.min(end.getTime(), now.getTime())).toISOString() };
}

export type ReportSnapshot = { observedAt: string; totalViews: number | null; publicationCount: number | null; totalLikes: number | null; followers: number | null; source: string | null; creatorType: string; producerId: number };
export type ChannelPeriod = { baselineAt: string | null; endAt: string | null; note: string;
  startViews: number | null; endViews: number | null; startVideos: number | null; endVideos: number | null; startLikes: number | null; endLikes: number | null };

export function periodMetrics(baseline: ReportSnapshot | null, ending: ReportSnapshot | null, period: ReturnType<typeof validateReportPeriod>, owner?: { creatorType: string; producerId: number }) {
  const tolerance = 36 * 3600000;
  const freshStart = baseline && baseline.observedAt <= period.start && Date.parse(period.start) - Date.parse(baseline.observedAt) <= tolerance;
  const freshEnd = ending && Date.parse(ending.observedAt) >= Date.parse(period.start)
    && ending.observedAt <= period.effectiveEnd
    && Date.parse(period.effectiveEnd) - Date.parse(ending.observedAt) <= tolerance;
  const ownerMatches = ending && (!owner || ending.creatorType === owner.creatorType && ending.producerId === owner.producerId);
  const compatible = baseline && ending && baseline.source === ending.source
    && baseline.creatorType === ending.creatorType && baseline.producerId === ending.producerId
    && ownerMatches;
  const distinct = baseline && ending && ending.observedAt > baseline.observedAt;
  const notes = new Set<string>();
  if (!freshStart) notes.add('Нет свежего снимка на начало периода');
  if (!freshEnd) notes.add('Нет свежего снимка на конец периода');
  if (baseline && ending && !compatible) notes.add('Изменился источник данных, тип или продюсер');
  if (baseline && ending && !distinct) notes.add('Нет второго снимка после начала периода');
  function delta(key: 'totalViews' | 'publicationCount' | 'totalLikes') {
    if (!freshStart || !freshEnd || !compatible || !distinct) return null;
    const a = baseline![key], b = ending![key];
    if (a === null || b === null) { notes.add('Часть показателей площадка не предоставила'); return null; }
    if (b < a) { notes.add('Счётчик уменьшился: удаление контента или корректировка площадкой'); return null; }
    return b - a;
  }
  const totalViews = delta('totalViews'), publicationCount = delta('publicationCount'), totalLikes = delta('totalLikes');
  return { totalViews, publicationCount, totalLikes, followers: freshEnd && ownerMatches ? ending!.followers : null,
    periodData: { baselineAt: baseline?.observedAt ?? null, endAt: ending?.observedAt ?? null,
      note: [...notes].join('; ') || 'Изменение счётчиков между указанными снимками',
      startViews: baseline?.totalViews ?? null, endViews: ending?.totalViews ?? null,
      startVideos: baseline?.publicationCount ?? null, endVideos: ending?.publicationCount ?? null,
      startLikes: baseline?.totalLikes ?? null, endLikes: ending?.totalLikes ?? null } };
}
