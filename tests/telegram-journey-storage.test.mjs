import test from 'node:test';
import assert from 'node:assert/strict';
import { storageHarness, onboard } from './storage-harness.mjs';
import { createTelegramBotFlow } from '../scripts/telegram-bot-flow.mjs';

const channelUrls = { YouTube: 'https://youtube.com/@owner', RuTube: 'https://rutube.ru/channel/12345/',
  VK: 'https://vk.com/id123', TikTok: 'https://tiktok.com/@owner', Instagram: 'https://instagram.com/owner', Threads: 'https://threads.com/@owner' };

async function fixture(t, { connected = true, platformName = 'YouTube' } = {}) {
  const h = storageHarness(); t.after(h.close);
  await onboard(h);
  const journey = h.load('db/telegram-journey.ts');
  const submit = h.load('db/telegram.ts').submitTelegramChannel;
  const channel = await submit({ telegramUserId: '2001', updateId: 10, sourceKind: 'channel', channelUrl: channelUrls[platformName] });
  if (connected) h.sqlite.prepare(`INSERT INTO social_connections(channel_id,creator_id,telegram_user_id,account_id,username,ciphertext,status,updated_at) SELECT id,creator_id,'2001','UC1234567890123456789012','fixture-owner','fixture-encrypted','connected',? FROM creator_channels WHERE id=?`).run(new Date().toISOString(), channel.id);
  return { h, journey, channel };
}

test('journey skips persist per creator and cannot hide an existing channel', async (t) => {
  const { h, journey } = await fixture(t);
  await onboard(h, { creatorId: '2002', producerId: '1002' });
  const a = { telegramUserId: '2001' };
  const result = await journey.setTelegramJourneyPlatform({ ...a, platformName: 'Threads', status: 'skipped' });
  assert.deepEqual(result.journey.skippedPlatforms, ['Threads']);
  assert.deepEqual((await journey.getTelegramJourney({ telegramUserId: '2002' })).journey.skippedPlatforms, []);
  await assert.rejects(journey.setTelegramJourneyPlatform({ ...a, platformName: 'YouTube', status: 'skipped' }), /уже есть канал/);
  assert.deepEqual((await journey.setTelegramJourneyPlatform({ ...a, platformName: 'Threads', status: 'needed' })).journey.skippedPlatforms, []);
  await assert.rejects(journey.setTelegramJourneyPlatform({ ...a, platformName: 'fake', status: 'skipped' }), /площадку/);
  await assert.rejects(journey.getTelegramJourney({ telegramUserId: '1001' }));
});

test('readiness names missing admin setup without returning app secrets', async (t) => {
  const { h, journey } = await fixture(t);
  h.env.CONTENT_PUBLIC_ORIGIN = 'https://example.test'; h.env.SOCIAL_VAULT_KEY = 'ab'.repeat(32);
  h.env.INSTAGRAM_CLIENT_SECRET = 'super-private-value';
  const result = await journey.getTelegramJourney({ telegramUserId: '2001' });
  const youtube = result.setup.find((p) => p.platformName === 'YouTube');
  assert.equal(youtube.available, false);
  assert.deepEqual(youtube.missing, ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET']);
  Object.assign(h.env, { YOUTUBE_CLIENT_ID: 'fixture-google-client', YOUTUBE_CLIENT_SECRET: 'super-private-google-secret' });
  assert.equal((await journey.getTelegramJourney({ telegramUserId: '2001' })).setup.find((p) => p.platformName === 'YouTube').available, false);
  h.env.YOUTUBE_OAUTH_ENABLED = 'true';
  const configured = await journey.getTelegramJourney({ telegramUserId: '2001' });
  assert.equal(configured.setup.find((p) => p.platformName === 'YouTube').available, true);
  assert.equal(JSON.stringify(configured).includes(h.env.YOUTUBE_CLIENT_SECRET), false);
  const ig = result.setup.find((p) => p.platformName === 'Instagram');
  assert.equal(ig.available, false); assert.match(ig.reason, /Администратор/);
  assert.equal(JSON.stringify(result).includes('super-private-value'), false);
});

test('recheck is owner only, throttled and never invalidates an active collector lease', async (t) => {
  const { h, journey, channel } = await fixture(t);
  await onboard(h, { creatorId: '2002', producerId: '1002' });
  const input = { telegramUserId: '2001', id: channel.id };
  await assert.rejects(journey.recheckTelegramChannel({ ...input, telegramUserId: '2002' }), /не найден/);
  assert.equal((await journey.recheckTelegramChannel(input)).queued, true);
  const repeated = await journey.recheckTelegramChannel(input);
  assert.equal(repeated.queued, false); assert.ok(repeated.retryAfterSeconds > 0);
  const [claim] = await h.load('db/storage.ts').claimDueChannels();
  assert.equal((await journey.recheckTelegramChannel(input)).inProgress, true);
  assert.equal(h.sqlite.prepare('SELECT lease_token FROM creator_channels WHERE id=?').get(channel.id).lease_token, claim.leaseToken);
  await h.load('db/storage.ts').updateChannel({ id: channel.id, status: 'inactive' });
  await assert.rejects(journey.recheckTelegramChannel(input), /приостановлен/);
});

test('new Telegram actions require service auth and creator access', async (t) => {
  const { h, channel } = await fixture(t);
  const POST = h.load('app/api/telegram/route.ts').POST;
  for (const action of ['journey', 'setJourneyPlatform', 'recheckChannel']) {
    const request = (secret) => POST(new Request('http://localhost/api/telegram', { method: 'POST', headers: {
      'content-type': 'application/json', 'x-sync-secret': secret,
    }, body: JSON.stringify({ action, telegramUserId: '2001', id: channel.id, platformName: 'Threads', status: 'skipped' }) }));
    assert.equal((await request('wrong')).status, 401);
    assert.equal((await request(h.env.SYNC_SECRET)).status, 200);
  }
});

test('recheck commit revalidates creator role, team status, channel state and collector lease', async (t) => {
  const changes = [
    "DELETE FROM social_connections",
    "UPDATE social_connections SET status='needs_auth'",
    "UPDATE telegram_accounts SET role=NULL WHERE telegram_user_id='2001'",
    "UPDATE producers SET status='inactive'",
    "UPDATE creators SET status='inactive'",
    "UPDATE platforms SET status='inactive' WHERE name='YouTube'",
    "UPDATE creator_channels SET status='inactive'",
    "UPDATE creator_channels SET deleted_at='2026-01-01'",
    "UPDATE creator_channels SET lease_until='2099-01-01',lease_token='another-collector'",
  ];
  for (const sql of changes) {
    const { h, journey, channel } = await fixture(t);
    h.sqlite.prepare("UPDATE creator_channels SET next_sync_at='2099-02-01',sync_status='success' WHERE id=?").run(channel.id);
    const batch = h.DB.batch.bind(h.DB);
    h.DB.batch = async (statements) => { h.sqlite.exec(sql); return batch(statements); };
    const result = await journey.recheckTelegramChannel({ telegramUserId: '2001', id: channel.id });
    assert.equal(result.queued, false, sql);
    assert.equal(h.sqlite.prepare('SELECT count(*) n FROM telegram_channel_rechecks').get().n, 0, sql);
    const record = h.sqlite.prepare('SELECT next_sync_at,sync_status,lease_token FROM creator_channels WHERE id=?').get(channel.id);
    assert.equal(record.next_sync_at, '2099-02-01', sql); assert.equal(record.sync_status, 'success', sql);
    if (sql.includes('another-collector')) assert.equal(record.lease_token, 'another-collector');
  }
});

test('two rechecks after the same initial read create only one receipt and leave metrics intact', async (t) => {
  const { h, journey, channel } = await fixture(t);
  h.sqlite.prepare('UPDATE creator_channels SET total_views=42 WHERE id=?').run(channel.id);
  const input = { telegramUserId: '2001', id: channel.id };
  const results = await Promise.all([journey.recheckTelegramChannel(input), journey.recheckTelegramChannel(input)]);
  assert.equal(results.filter((result) => result.queued).length, 1);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM telegram_channel_rechecks').get().n, 1);
  assert.equal(h.sqlite.prepare('SELECT total_views FROM creator_channels WHERE id=?').get(channel.id).total_views, 42);
});


await test('every OAuth platform requests missing or revoked personal access without changing the queue or historical metrics', async (t) => {
  for (const platformName of Object.keys(channelUrls).filter((name) => name !== 'RuTube')) {
    for (const connected of [false, true]) {
      const { h, journey, channel } = await fixture(t, { connected, platformName });
      h.env.YOUTUBE_API_KEY = 'configured-but-not-used-server-key';
      if (connected) h.sqlite.exec("UPDATE social_connections SET status='needs_auth'");
      h.sqlite.prepare("UPDATE creator_channels SET total_views=42,sync_status='success',next_sync_at='2099-01-01' WHERE id=?").run(channel.id);
      const before = h.sqlite.prepare('SELECT * FROM creator_channels WHERE id=?').get(channel.id);
      const result = await journey.recheckTelegramChannel({ telegramUserId: '2001', id: channel.id });
      assert.deepEqual(result, { needsAccess: true, queued: false, inProgress: false, retryAfterSeconds: 0, platformName });
      assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM telegram_channel_rechecks').get().n, 0);
      assert.deepEqual(h.sqlite.prepare('SELECT * FROM creator_channels WHERE id=?').get(channel.id), before);
    }
  }
});

await test('connected OAuth platforms and public RuTube can recheck while retaining counters', async (t) => {
  for (const platformName of Object.keys(channelUrls)) {
    const { h, journey, channel } = await fixture(t, { connected: platformName !== 'RuTube', platformName });
    h.sqlite.prepare("UPDATE creator_channels SET total_views=42,next_sync_at='2099-01-01' WHERE id=?").run(channel.id);
    const result = await journey.recheckTelegramChannel({ telegramUserId: '2001', id: channel.id });
    assert.equal(result.queued, true, platformName); assert.equal(result.needsAccess, undefined);
    assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM telegram_channel_rechecks').get().n, 1);
    assert.equal(h.sqlite.prepare('SELECT total_views FROM creator_channels WHERE id=?').get(channel.id).total_views, 42);
    if (platformName === 'RuTube') assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM social_connections').get().n, 0);
  }
});

await test('each OAuth platform rechecks access atomically if it is revoked between initial read and queue commit', async (t) => {
  for (const platformName of Object.keys(channelUrls).filter((name) => name !== 'RuTube')) {
    for (const change of ["DELETE FROM social_connections", "UPDATE social_connections SET status='needs_auth'"]) {
      const { h, journey, channel } = await fixture(t, { platformName });
      h.sqlite.prepare("UPDATE creator_channels SET next_sync_at='2099-02-01',sync_status='success' WHERE id=?").run(channel.id);
      const before = h.sqlite.prepare('SELECT * FROM creator_channels WHERE id=?').get(channel.id);
      const batch = h.DB.batch.bind(h.DB);
      h.DB.batch = async (statements) => { h.sqlite.exec(change); return batch(statements); };
      const result = await journey.recheckTelegramChannel({ telegramUserId: '2001', id: channel.id });
      assert.equal(result.queued, false, `${platformName}: ${change}`);
      assert.equal(result.retryAfterSeconds, 0, 'A refused write must not claim a prior recheck exists');
      assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM telegram_channel_rechecks').get().n, 0);
      assert.deepEqual(h.sqlite.prepare('SELECT * FROM creator_channels WHERE id=?').get(channel.id), before);
    }
  }
});

await test('stale bot recheck buttons offer the correct platform login when backend denies queueing without access', async (t) => {
  for (const platformName of Object.keys(channelUrls).filter((name) => name !== 'RuTube')) {
    const { journey, channel } = await fixture(t, { connected: false, platformName });
    const sent = [];
    const flow = createTelegramBotFlow({ backend: async (action, fields) => {
      assert.equal(action, 'recheckChannel'); return journey.recheckTelegramChannel(fields);
    }, send: async (_chat, text, extra) => sent.push({ text, extra }), answerCallback: async () => {} });
    await flow.handleCallback({ update_id: 20, callback_query: { id: 'fixture', from: { id: 2001 }, message: { chat: { id: 2001, type: 'private' } }, data: `channel:check:${channel.id}` } });
    assert.equal(sent.length, 1);
    assert.ok(sent[0].text.includes(`подключите ${platformName}`));
    assert.doesNotMatch(sent[0].text, /Запрос на проверку принят|проверка.*очереди|Повторный запрос доступен/i);
    const buttons = sent[0].extra.reply_markup.inline_keyboard.flat();
    assert.ok(buttons.some((button) => button.callback_data === `social:connect:${channel.id}`));
    assert.ok(buttons.some((button) => button.callback_data === `social:file:${platformName}`));
  }
});
