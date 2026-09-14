import test from 'node:test';
import assert from 'node:assert/strict';
import { storageHarness, onboard } from './storage-harness.mjs';

async function setup(t) {
  const h = storageHarness(); t.after(h.close);
  const { context } = await onboard(h);
  const storage = h.load('db/storage.ts');
  const submit = h.load('db/telegram.ts').submitTelegramChannel;
  const input = { telegramUserId: '2001', updateId: 10, sourceKind: 'channel', channelUrl: 'https://vk.ru/club123', providerChannelId: '-123', handle: 'club123' };
  const channel = await submit(input);
  return { h, storage, submit, input, id: channel.id, ownerId: context.binding.id };
}

test('delete archives only the owner channel, frees URL/identity, keeps replay receipt and rejects late collector', async (t) => {
  const { h, storage, id, ownerId, submit, input } = await setup(t);
  const [claim] = await storage.claimDueChannels();
  await storage.deleteChannel({ id }, ownerId);
  await storage.deleteChannel({ id }, ownerId);
  const row = h.sqlite.prepare('SELECT * FROM creator_channels WHERE id=?').get(id);
  assert.ok(row.deleted_at);
  assert.equal(row.url, 'https://vk.com/club123');
  assert.equal(row.lease_token, null);
  assert.equal(row.provider_channel_id, null);
  assert.equal((await storage.getDashboardData()).channels.length, 0);
  assert.equal((await h.load('db/telegram-onboarding.ts').listTelegramChannels({ telegramUserId: '2001' })).length, 0);
  assert.equal((await storage.claimDueChannels()).length, 0);
  await assert.rejects(storage.completeChannelSync({ channelId: id, leaseToken: claim.leaseToken, observedAt: new Date().toISOString(), parserSource: 'fixture', totalViews: 1 }));
  assert.equal((await submit(input)).status, 'deleted');
  assert.equal((await submit(input)).normalizedUrl, 'https://vk.com/club123');
  const again = await submit({ ...input, updateId: 11 });
  assert.notEqual(again.id, id);
  assert.equal(again.resultStatus, 'created');
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM creators').get().n, 1);
  await assert.rejects(storage.updateChannel({ id, status: 'active' }), /не найден/);
});
test('URL edits get a fresh channel history, canonical aliases retain metrics, duplicates roll back', async (t) => {
  const { h, storage, id, ownerId } = await setup(t);
  h.sqlite.prepare('UPDATE creator_channels SET total_views=123,total_views_override=999 WHERE id=?').run(id);
  assert.equal(await storage.updateChannel({ id, url: 'https://vk.ru/club123' }, ownerId), id);
  assert.equal(h.sqlite.prepare('SELECT total_views FROM creator_channels WHERE id=?').get(id).total_views, 123);
  const replacement = await storage.updateChannel({ id, url: 'https://youtube.com/@new' }, ownerId);
  assert.notEqual(replacement, id);
  const row = h.sqlite.prepare('SELECT * FROM creator_channels WHERE id=?').get(replacement);
  assert.equal(row.creator_id, ownerId);
  assert.equal(row.total_views, null);
  assert.equal(row.total_views_override, null);
  assert.equal(row.provider_channel_id, null);
  assert.equal(row.sync_status, 'pending');
  const second = await storage.createChannel({ creatorId: ownerId, url: 'https://youtube.com/@taken' });
  await assert.rejects(storage.updateChannel({ id: replacement, url: 'https://youtube.com/@taken' }, ownerId), /UNIQUE/);
  assert.equal((await storage.getDashboardData()).channels.length, 2);
  assert.equal(h.sqlite.prepare('SELECT deleted_at FROM creator_channels WHERE id=?').get(replacement).deleted_at, null);
  assert.ok(second);
});
test('Telegram mutations recheck ownership, role and service authentication; ignore manual metric/owner input', async (t) => {
  const { h, storage, id } = await setup(t);
  await onboard(h, { producerId: '1002', creatorId: '2002' });
  const POST = h.load('app/api/telegram/route.ts').POST;
  const request = (body, secret = h.env.SYNC_SECRET) => POST(new Request('http://localhost/api/telegram', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sync-secret': secret }, body: JSON.stringify(body) }));
  for (const action of ['deleteChannel', 'updateChannel']) {
    assert.equal((await request({ action, telegramUserId: '2002', id, url: 'https://youtube.com/@intruder' })).status, 404);
    assert.equal((await request({ action, telegramUserId: '1001', id })).status, 409);
    assert.equal((await request({ action, telegramUserId: '2001', id }, 'wrong')).status, 401);
  }
  assert.equal((await request({ action: 'updateChannel', telegramUserId: '2001', id, status: 'inactive', creatorId: 999, totalViewsOverride: 123 })).status, 200);
  const row = h.sqlite.prepare('SELECT * FROM creator_channels WHERE id=?').get(id);
  assert.equal(row.status, 'inactive');
  assert.equal(row.total_views_override, null);
  assert.equal((await storage.getDashboardData()).channels.length, 1);
});
