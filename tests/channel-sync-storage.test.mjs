import test from 'node:test';
import assert from 'node:assert/strict';
import { storageHarness, onboard } from './storage-harness.mjs';

async function setup(t) {
  const h = storageHarness(); t.after(h.close);
  const { context } = await onboard(h);
  const storage = h.load('db/storage.ts');
  const id = await storage.createChannel({ creatorId: context.binding.id, url: 'https://youtube.com/@fixture' });
  return { h, storage, id, context };
}

test('claims are exclusive, released after success, next sync is in 24 hours', async (t) => {
  const { h, storage, id } = await setup(t);
  const claims = await Promise.all([storage.claimDueChannels(), storage.claimDueChannels()]);
  assert.equal(claims.flat().length, 1);
  const claim = claims.flat()[0];
  const input = { channelId: id, observedAt: new Date().toISOString(), leaseToken: claim.leaseToken, parserSource: 'fixture', followers: 0, title: 'Known' };
  assert.equal((await storage.completeChannelSync(input)).duplicate, false);
  assert.equal((await storage.completeChannelSync(input)).duplicate, true);
  const channel = h.sqlite.prepare('SELECT * FROM creator_channels WHERE id = ?').get(id);
  assert.equal(channel.followers, 0);
  assert.equal(channel.total_views, null);
  assert.equal(channel.lease_token, null);
  assert.ok(Math.abs(Date.parse(channel.next_sync_at) - Date.now() - 86400000) < 2000);
  assert.equal((await storage.claimDueChannels()).length, 0);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM channel_sync_history').get().n, 1);
});

test('empty metrics, wrong lease, mismatched provider ID and stale result rejected', async (t) => {
  const { h, storage, id } = await setup(t);
  const [claim] = await storage.claimDueChannels();
  const input = { channelId: id, observedAt: new Date().toISOString(), leaseToken: claim.leaseToken, parserSource: 'fixture' };
  await assert.rejects(storage.completeChannelSync(input), /ни одной метрики/);
  await assert.rejects(storage.completeChannelSync({ ...input, leaseToken: 'wrong', followers: 1 }), /Аренда/);
  h.sqlite.prepare('UPDATE creator_channels SET provider_channel_id = ? WHERE id = ?').run('UC1111111111111111111111', id);
  await assert.rejects(storage.completeChannelSync({ ...input, providerChannelId: 'different', followers: 1 }), /не совпадает/);
  await storage.completeChannelSync({ ...input, followers: 1 });
  await assert.rejects(storage.completeChannelSync({ ...input, observedAt: new Date(Date.parse(input.observedAt) - 1000).toISOString(), followers: 2 }), /устаревшие/);
});

test('failed extraction keeps prior metrics and schedules bounded retry', async (t) => {
  const { h, storage, id } = await setup(t);
  h.sqlite.prepare("UPDATE creator_channels SET followers = 7, total_views = 100, title = 'Known' WHERE id = ?").run(id);
  const [claim] = await storage.claimDueChannels();
  const input = { channelId: id, leaseToken: claim.leaseToken, observedAt: new Date().toISOString(), status: 'error', error: 'provider unavailable', parserSource: 'fixture' };
  await storage.failChannelSync(input);
  assert.equal((await storage.failChannelSync(input)).duplicate, true);
  const channel = h.sqlite.prepare('SELECT * FROM creator_channels WHERE id = ?').get(id);
  assert.equal(channel.followers, 7);
  assert.equal(channel.total_views, 100);
  assert.equal(channel.sync_status, 'error');
  assert.equal(channel.consecutive_failures, 1);
  assert.ok(Math.abs(Date.parse(channel.next_sync_at) - Date.now() - 15 * 60000) < 2000);
});

test('likes survive parser, history, dashboard, correction and Telegram; negative input is rejected', async (t) => {
  const { h, storage, id } = await setup(t);
  const [claim] = await storage.claimDueChannels();
  const input = { channelId: id, observedAt: new Date().toISOString(), leaseToken: claim.leaseToken, parserSource: 'fixture', totalLikes: 0, totalViews: 100, publicationCount: 10 };
  await assert.rejects(storage.completeChannelSync({ ...input, totalLikes: -1 }));
  await storage.completeChannelSync(input);
  assert.equal(h.sqlite.prepare('SELECT total_likes FROM channel_sync_history WHERE channel_id = ?').get(id).total_likes, 0);
  assert.equal((await storage.getDashboardData()).channels.find((c) => c.id === id).effectiveTotalLikes, 0);
  await storage.updateChannel({ id, totalLikesOverride: 42 });
  assert.equal((await storage.getDashboardData()).channels.find((c) => c.id === id).effectiveTotalLikes, 42);
  const channels = await h.load('db/telegram-onboarding.ts').listTelegramChannels({ telegramUserId: '2001' });
  assert.equal(channels[0].totalLikes, 42);
  await storage.updateChannel({ id, totalLikesOverride: null });
  assert.equal((await storage.getDashboardData()).channels.find((c) => c.id === id).effectiveTotalLikes, 0);
  await assert.rejects(storage.updateChannel({ id, totalLikesOverride: -1 }));
});

test('disabled creator, producer, channel and platform cannot be collected', async (t) => {
  const { h, storage } = await setup(t);
  for (const table of ['creators', 'producers', 'creator_channels', 'platforms']) {
    h.sqlite.exec(`UPDATE ${table} SET status = 'inactive'`);
    assert.equal((await storage.claimDueChannels()).length, 0, table);
    h.sqlite.exec(`UPDATE ${table} SET status = 'active'`);
  }
  const [claim] = await storage.claimDueChannels();
  h.sqlite.prepare("UPDATE creator_channels SET lease_until = '2000-01-01' WHERE id = ?").run(claim.id);
  assert.equal((await storage.claimDueChannels()).length, 1, 'expired lease recovers after restart');
});

test('service endpoints enforce auth, content type, JSON, size and old-bind lockdown', async (t) => {
  const h = storageHarness(); t.after(h.close);
  for (const path of ['app/api/telegram/route.ts', 'app/api/sync/route.ts']) {
    const { POST } = h.load(path);
    const request = (body, headers = {}) => new Request('http://localhost/api', { method: 'POST', headers: { 'x-sync-secret': h.env.SYNC_SECRET, 'content-type': 'application/json', ...headers }, body });
    assert.equal((await POST(request('{}', { 'x-sync-secret': 'bad' }))).status, 401);
    assert.equal((await POST(request('{}', { 'content-type': 'text/plain' }))).status, 415);
    assert.equal((await POST(request('{'))).status, 400);
    assert.equal((await POST(request('[]'))).status, 400);
    assert.equal((await POST(request(' '.repeat(33000)))).status, 413);
    assert.equal((await POST(request('{"action":"unknown"}'))).status, 400);
    if (path.includes('telegram')) assert.equal((await POST(request('{"action":"bind","telegramUserId":"2001","creatorId":1}'))).status, 403);
    const secret = h.env.SYNC_SECRET; delete h.env.SYNC_SECRET;
    assert.equal((await POST(request('{}'))).status, 503);
    h.env.SYNC_SECRET = secret;
  }
});
