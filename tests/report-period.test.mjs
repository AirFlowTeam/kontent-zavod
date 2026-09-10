import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { storageHarness, onboard } from './storage-harness.mjs';

test('period dates are inclusive Moscow days; missing, reversed, impossible and future dates fail', (t) => {
  const h = storageHarness(); t.after(h.close);
  const { validateReportPeriod: validate, moscowToday } = h.load('lib/report-period.ts');
  const now = new Date('2026-09-10T21:30:00Z');
  assert.equal(moscowToday(now), '2026-09-11');
  assert.deepEqual(validate('2026-09-09', '2026-09-10', now), {
    from: '2026-09-09', to: '2026-09-10', start: '2026-09-08T21:00:00.000Z', end: '2026-09-10T21:00:00.000Z', effectiveEnd: '2026-09-10T21:00:00.000Z',
  });
  assert.equal(validate('2026-09-11', '2026-09-11', now).effectiveEnd, now.toISOString());
  for (const [from, to] of [['', '2026-09-10'], ['2026-09-10', ''], ['2026-02-30', '2026-09-10'], ['2026-09-10', '2026-09-09'], ['2026-09-11', '2026-09-12']]) assert.throws(() => validate(from, to, now));
});

test('period deltas preserve unknowns, true zeros, snapshot freshness and attribution', (t) => {
  const h = storageHarness(); t.after(h.close);
  const { validateReportPeriod, periodMetrics: metrics } = h.load('lib/report-period.ts');
  const p = validateReportPeriod('2026-09-02', '2026-09-03', new Date('2026-09-10T00:00:00Z'));
  const a = { observedAt: '2026-09-01T20:00:00.000Z', totalViews: 100, publicationCount: 10, totalLikes: 0, followers: 20, source: 'fixture', creatorType: 'UGC', producerId: 1 };
  const b = { ...a, observedAt: '2026-09-03T20:00:00.000Z', totalViews: 150, publicationCount: 12, totalLikes: 0, followers: 25 };
  const result = metrics(a, b, p);
  assert.deepEqual([result.totalViews, result.publicationCount, result.totalLikes, result.followers], [50, 2, 0, 25]);
  assert.equal(metrics(null, b, p).totalViews, null);
  assert.equal(metrics(a, null, p).totalViews, null);
  assert.equal(metrics({ ...a, observedAt: '2026-08-28T20:00:00.000Z' }, b, p).totalViews, null);
  assert.equal(metrics(a, { ...b, observedAt: '2026-09-04T20:00:00.000Z' }, p).totalViews, null);
  assert.equal(metrics(a, { ...b, source: 'other' }, p).totalViews, null);
  assert.equal(metrics(a, { ...b, totalLikes: null }, p).totalLikes, null);
  assert.equal(metrics(a, { ...b, publicationCount: 9 }, p).publicationCount, null);
  const reassigned = metrics(a, b, p, { creatorType: 'AI', producerId: 2 });
  assert.equal(reassigned.totalViews, null); assert.equal(reassigned.followers, null);
  const boundary = { ...a, observedAt: p.start };
  assert.equal(metrics(boundary, boundary, p).totalViews, null);
});

test('period endpoint uses history boundaries, excludes failed/out-of-period snapshots and ignores current overrides', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const { context } = await onboard(h);
  const storage = h.load('db/storage.ts');
  const id = await storage.createChannel({ creatorId: context.binding.id, url: 'https://www.tiktok.com/@fixture' });
  const empty = await storage.createChannel({ creatorId: context.binding.id, url: 'https://www.tiktok.com/@empty' });
  h.sqlite.prepare('UPDATE creator_channels SET total_views = 9999, total_views_override = 10000, total_likes_override = 88 WHERE id = ?').run(id);
  const put = h.sqlite.prepare(`INSERT INTO channel_sync_history(channel_id, status, observed_at, recorded_at, source, creator_type_snapshot, producer_id_snapshot, total_views, publication_count, total_likes, followers)
    VALUES (?, ?, ?, ?, 'fixture', 'UGC', ?, ?, ?, ?, 25)`);
  for (const [at, views, videos, likes, status = 'success'] of [
    ['2026-09-01T20:00:00.000Z', 100, 10, 0],
    ['2026-09-03T20:00:00.000Z', 150, 12, 0],
    ['2026-09-03T20:30:00.000Z', 500, 50, 5, 'error'],
    ['2026-09-03T21:00:00.000Z', 900, 80, 9],
  ]) put.run(id, status, at, at, context.binding.producerId, views, videos, likes);
  const { GET } = h.load('app/api/report/route.ts');
  const response = await GET(new Request('http://localhost/api/report?from=2026-09-02&to=2026-09-03'));
  assert.equal(response.status, 200);
  const data = await response.json();
  const channel = data.channels.find((c) => c.id === id);
  assert.equal(channel.totalViews, 50); assert.equal(channel.effectiveTotalViews, 50);
  assert.equal(channel.totalViewsOverride, null); assert.equal(channel.totalLikes, 0);
  assert.equal(channel.publicationCount, 2);
  assert.equal(data.channels.find((c) => c.id === empty).totalViews, null);
  assert.equal(channel.periodData.baselineAt, '2026-09-01T20:00:00.000Z');
  assert.equal(channel.periodData.endAt, '2026-09-03T20:00:00.000Z');
  const { makeMetrics, buildCreatorRows, buildProducerRows } = h.load('lib/content-metrics.ts');
  const totals = makeMetrics(data.channels);
  assert.equal(totals.totalViews, 50); assert.equal(totals.totalViewsCount, 1); assert.equal(totals.totalLikesCount, 1);
  const workbook = h.load('lib/xlsx-export.ts').createGoogleSheetsWorkbook({ ...data, metrics: totals, ugc: totals, ai: makeMetrics([]), creatorRows: buildCreatorRows(data.channels, data.creators), producerRows: buildProducerRows(data.channels, data.producers) });
  const files = unzipSync(workbook);
  assert.match(strFromU8(files['xl/workbook.xml']), /Снимки периода/);
  assert.match(strFromU8(files['xl/worksheets/sheet1.xml']), /2026-09-02 — 2026-09-03/);
  assert.match(strFromU8(files['xl/worksheets/sheet2.xml']), /Лайки/);
  assert.match(strFromU8(files['xl/worksheets/sheet5.xml']), /Нет свежего снимка/);
  assert.doesNotMatch(strFromU8(files['xl/worksheets/sheet2.xml']), /10000|9999/);
  for (const query of ['', '?from=bad&to=bad', '?from=2026-09-03&to=2026-09-02']) assert.equal((await GET(new Request(`http://localhost/api/report${query}`))).status, 400);
});
