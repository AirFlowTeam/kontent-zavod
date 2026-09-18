import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramBotFlow } from '../scripts/telegram-bot-flow.mjs';
import { socialJourney, channelJourney } from '../lib/social-journey.mjs';
import { storageHarness, onboard } from './storage-harness.mjs';

async function conversation(t) {
  const h = storageHarness(); t.after(h.close);
  await onboard(h);
  const POST = h.load('app/api/telegram/route.ts').POST;
  const backend = async (action, fields) => {
    const response = await POST(new Request('http://localhost/api/telegram', { method: 'POST', headers: {
      'content-type': 'application/json', 'x-sync-secret': h.env.SYNC_SECRET,
    }, body: JSON.stringify({ action, ...fields }) }));
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error), { status: response.status, userSafe: response.status < 500 });
    return body;
  };
  const sent = [], files = [];
  let sequence = 900;
  const makeFlow = () => createTelegramBotFlow({ backend, send: async (chat, text, extra) => sent.push({ chat, text, extra }),
    sendGuide: async (chat, platform) => files.push({ chat, platform }), answerCallback: async () => {}, botUsername: () => 'fixture_bot',
    processLink: async (_chat, user, updateId, url, itemIndex) => backend('submit', { telegramUserId: String(user.id), updateId, itemIndex, sourceKind: 'channel', channelUrl: url }) });
  let flow = makeFlow();
  const message = (text) => flow.handleMessage({ update_id: ++sequence, message: { from: { id: 2001 }, chat: { id: 2001, type: 'private' }, text } });
  const callback = (data, id = 2001) => flow.handleCallback({ update_id: ++sequence, callback_query: { id: String(sequence), from: { id }, message: { chat: { id, type: 'private' } }, data } });
  const buttons = () => sent.at(-1).extra.reply_markup.inline_keyboard.flat();
  return { h, sent, files, backend, message, callback, buttons, restart: () => { flow = makeFlow(); } };
}

function connectFixture(c, id) {
  c.h.sqlite.prepare(`INSERT INTO social_connections(channel_id,creator_id,telegram_user_id,account_id,username,ciphertext,status,updated_at)
    SELECT id,creator_id,'2001','UC1234567890123456789012','fixture','fixture-encrypted','connected','2026-09-17' FROM creator_channels WHERE id=?`).run(id);
  c.h.sqlite.prepare("UPDATE creator_channels SET sync_status='pending' WHERE id=?").run(id);
}

test('one channel goes straight to access and resumes after restart without other platforms', async (t) => {
  const c = await conversation(t);
  await c.message('/start');
  assert.ok(c.buttons().some((b) => b.callback_data === 'menu:add-channel'));
  await c.callback('menu:add-channel');
  await c.callback('guide:link:YouTube:0');
  assert.match(c.sent.at(-1).text, /Отправьте ссылку/);
  await c.message('https://youtube.com/@fixture');
  const channel = (await c.backend('channels', { telegramUserId: '2001', scope: 'own' })).channels[0];
  assert.ok(c.buttons().some((b) => b.callback_data === `social:connect:${channel.id}`));
  assert.ok(c.buttons().length <= 3);
  assert.doesNotMatch(JSON.stringify(c.sent), /journey:skip:|из 6/);
  c.restart(); await c.message('/guide');
  assert.ok(c.buttons().some((b) => b.callback_data === `social:connect:${channel.id}`));
  connectFixture(c, channel.id);
  await c.callback(`channel:check:${channel.id}`);
  assert.ok(c.sent.some((item) => /Запрос на проверку принят/.test(item.text)));
  const before = c.h.sqlite.prepare('SELECT * FROM creator_channels WHERE id=?').get(channel.id);
  assert.ok(c.buttons().some((b) => b.callback_data === `channel:show:${channel.id}`));
  await c.callback(`channel:show:${channel.id}`);
  assert.deepEqual(c.h.sqlite.prepare('SELECT * FROM creator_channels WHERE id=?').get(channel.id), before);
  await c.callback(`channel:check:${channel.id}`);
  assert.ok(c.sent.some((item) => /Повторный запрос доступен/.test(item.text)));
  c.h.sqlite.prepare("UPDATE creator_channels SET sync_status='success', total_views=100, total_likes=5, publication_count=2 WHERE id=?").run(channel.id);
  await c.message('/guide');
  assert.match(c.sent.at(-1).text, /Просмотры: 100/);
  assert.match(c.sent.at(-1).text, /показатели получены/);
  assert.ok(c.buttons().some((b) => b.callback_data === 'menu:add-channel'));
});

test('blocked OAuth tells the creator who must configure it and offers files and a specific recheck', async (t) => {
  const c = await conversation(t);
  c.h.env.CONTENT_PUBLIC_ORIGIN = 'https://example.test'; c.h.env.SOCIAL_VAULT_KEY = 'ab'.repeat(32);
  await c.message('https://instagram.com/fixture');
  const channel = (await c.backend('channels', { telegramUserId: '2001', scope: 'own' })).channels[0];
  c.h.sqlite.prepare("UPDATE creator_channels SET sync_status='needs_auth' WHERE id=?").run(channel.id);
  await c.message('/guide');
  assert.ok(c.buttons().some((b) => b.callback_data === `social:connect:${channel.id}`));
  await c.callback(`social:connect:${channel.id}`);
  assert.match(c.sent.at(-1).text, /Администратор.*не настроил вход Instagram/);
  assert.equal(c.buttons().some((button) => button.url), false);
  assert.equal(c.h.sqlite.prepare('SELECT COUNT(*) n FROM social_connect_tickets').get().n, 0);
  assert.ok(c.buttons().some((button) => button.callback_data === `channel:show:${channel.id}`));
  await c.callback(`channel:help:${channel.id}`);
  assert.ok(c.buttons().some((button) => button.callback_data === 'social:file:Instagram'));
  await c.callback('social:file:Instagram'); await c.callback('guide:file');
  assert.deepEqual(c.files, [{ chat: 2001, platform: 'Instagram' }, { chat: 2001, platform: undefined }]);
  await assert.rejects(c.callback(`channel:check:${channel.id}`, 1001), /тип|приглашение|канал|профиль/i);
});

test('missing views remain actionable; RuTube likes and VK coverage are honest limitations', () => {
  const base = { id: 1, platformName: 'Instagram', status: 'active', syncStatus: 'success', publicationCount: 2, totalLikes: 4, totalViews: null };
  assert.equal(channelJourney(base).state, 'access');
  assert.equal(channelJourney({ ...base, connectionStatus: 'connected' }).state, 'check');
  assert.equal(channelJourney({ ...base, totalViews: 0 }).state, 'ready');
  assert.equal(channelJourney({ ...base, totalViews: 1, connectionStatus: 'needs_auth' }).state, 'access');
  assert.equal(channelJourney({ ...base, platformName: 'RuTube', totalViews: 1, totalLikes: null }).state, 'limited');
  assert.equal(channelJourney({ ...base, platformName: 'VK', totalViews: 1, parserSource: 'vk-api-own-added-videos-clips-not-guaranteed' }).state, 'limited');
  const journey = socialJourney([base], ['Instagram', 'YouTube']);
  assert.equal(journey.platforms.find((platform) => platform.platformName === 'Instagram').skipped, false);
  assert.equal(journey.complete, false);
});

test('every YouTube entry point offers Google login while legacy key connections keep their metrics', async (t) => {
  const c = await conversation(t);
  c.h.env.CONTENT_PUBLIC_ORIGIN = 'https://example.test'; c.h.env.SOCIAL_VAULT_KEY = 'ab'.repeat(32);
  c.h.env.YOUTUBE_API_KEY = 'fixture-shared-server-key';
  c.h.env.YOUTUBE_CLIENT_ID = 'fixture-client-id'; c.h.env.YOUTUBE_CLIENT_SECRET = 'fixture-client-secret';
  c.h.env.YOUTUBE_OAUTH_ENABLED = 'true';
  await c.message('https://youtube.com/@fixture');
  const channel = (await c.backend('channels', { telegramUserId: '2001', scope: 'own' })).channels[0];
  assert.match(c.sent.at(-1).text, /нужно подключить YouTube через Google/);
  assert.ok(c.buttons().some((button) => button.callback_data === `social:connect:${channel.id}`));
  assert.equal(c.buttons().some((button) => button.callback_data === `channel:check:${channel.id}`), false);
  c.h.sqlite.prepare("UPDATE creator_channels SET sync_status='needs_auth' WHERE id=?").run(channel.id);
  await c.message('/guide');
  assert.match(c.sent.at(-1).text, /нужно подключить YouTube через Google/);
  await c.message('/api');
  assert.match(c.sent.at(-1).text, /подключить YouTube через Google/);
  assert.ok(c.buttons().some((button) => button.callback_data === `social:connect:${channel.id}`));
  await c.callback(`social:connect:${channel.id}`);
  assert.match(c.sent.at(-1).text, /Войдите через Google аккаунтом владельца/);
  assert.equal(c.h.sqlite.prepare('SELECT COUNT(*) n FROM social_connect_tickets').get().n, 1);
  assert.ok(c.buttons().some((button) => button.url?.startsWith('https://example.test/connect/')));
  await c.message('/channels');
  const card = c.sent.at(-1);
  assert.match(card.text, /подключить YouTube через Google/);
  assert.equal(card.extra.reply_markup.inline_keyboard[0][0].callback_data, `social:connect:${channel.id}`);
  assert.equal(card.extra.reply_markup.inline_keyboard.flat().some((button) => button.callback_data === `channel:check:${channel.id}`), false);
  await c.callback(`social:personal:${channel.id}`);
  assert.match(c.sent.at(-1).text, /Войдите через Google аккаунтом владельца/);
  assert.equal(c.h.sqlite.prepare('SELECT COUNT(*) n FROM social_connect_tickets').get().n, 1);
  assert.ok(!JSON.stringify(c.sent).includes(c.h.env.YOUTUBE_API_KEY));
  assert.doesNotMatch(JSON.stringify(c.sent), /Google Cloud|Credentials|API-ключ|личный ключ/);
  connectFixture(c, channel.id);
  await c.message('/channels');
  const connected = c.sent.at(-1);
  assert.ok(connected.extra.reply_markup.inline_keyboard.flat().some((button) => button.callback_data === `channel:show:${channel.id}`));
  c.h.sqlite.prepare("UPDATE social_connections SET status='needs_auth' WHERE channel_id=?").run(channel.id);
  await c.message('/channels');
  assert.equal(c.sent.at(-1).extra.reply_markup.inline_keyboard[0][0].text, 'Войти через Google');
});

test('YouTube progress accepts existing credentials but still requires actual counters', () => {
  const setup = { platformName: 'YouTube', sharedKeyConfigured: true };
  const channel = { id: 1, platformName: 'YouTube', status: 'active', totalViews: null, totalLikes: null, publicationCount: null };
  for (const syncStatus of ['pending', 'error', 'needs_auth', 'success']) {
    const state = channelJourney({ ...channel, syncStatus }, setup);
    assert.equal(state.state, 'access'); assert.equal(state.callback, 'social:connect:1');
  }
  assert.equal(channelJourney({ ...channel, status: 'inactive' }, setup).state, 'access');
  assert.equal(channelJourney({ ...channel, status: 'inactive', connectionStatus: 'connected' }, setup).state, 'paused');
  const complete = { ...channel, syncStatus: 'success', totalViews: 0, totalLikes: 0, publicationCount: 0 };
  assert.equal(channelJourney(complete, setup).state, 'access');
  assert.equal(channelJourney({ ...complete, connectionStatus: 'connected' }, setup).state, 'ready');
  assert.equal(channelJourney({ ...channel, connectionStatus: 'connected', syncStatus: 'pending' }, setup).state, 'check');
  assert.equal(channelJourney({ ...complete, connectionStatus: 'needs_auth' }, setup).state, 'access');
  assert.equal(socialJourney([{ ...channel, syncStatus: 'needs_auth' }], [], [setup]).nextChannel.state, 'access');
});

test('a stale check button prompts for Google login without claiming collection was queued', async () => {
  const sent = [], calls = [];
  const flow = createTelegramBotFlow({ backend: async (action, fields) => {
    calls.push({ action, fields });
    assert.equal(action, 'recheckChannel');
    return { queued: false, inProgress: false, retryAfterSeconds: 0, needsAccess: true, platformName: 'YouTube' };
  }, send: async (_, text, extra) => sent.push({ text, extra }), answerCallback: async () => {}, botUsername: () => 'fixture_bot', processLink: async () => {} });
  await flow.handleCallback({ update_id: 1, callback_query: { id: '1', from: { id: 2001 }, message: { chat: { id: 2001, type: 'private' } }, data: 'channel:check:12' } });
  assert.equal(calls.length, 1);
  assert.match(sent.at(-1).text, /Сначала подключите YouTube через Google/);
  assert.doesNotMatch(sent.at(-1).text, /Запрос на проверку принят|уже проверяется/);
  assert.equal(sent.at(-1).extra.reply_markup.inline_keyboard[0][0].callback_data, 'social:connect:12');
  assert.ok(sent.at(-1).extra.reply_markup.inline_keyboard.flat().some((button) => button.callback_data === 'social:file:YouTube'));
});

test('configured Google app stays blocked until enabled; legacy stats remain usable while login is off', async (t) => {
  const c = await conversation(t);
  Object.assign(c.h.env, { CONTENT_PUBLIC_ORIGIN: 'https://example.test', SOCIAL_VAULT_KEY: 'ab'.repeat(32),
    YOUTUBE_CLIENT_ID: 'fixture-client-id', YOUTUBE_CLIENT_SECRET: 'fixture-client-secret' });
  await c.message('https://youtube.com/@fixture');
  const channel = (await c.backend('channels', { telegramUserId: '2001', scope: 'own' })).channels[0];
  await c.callback(`social:personal:${channel.id}`);
  assert.match(c.sent.at(-1).text, /Администратор.*не настроил вход YouTube/);
  assert.equal(c.buttons().some((button) => button.url), false);
  assert.equal(c.h.sqlite.prepare('SELECT COUNT(*) n FROM social_connect_tickets').get().n, 0);
  connectFixture(c, channel.id);
  c.h.sqlite.prepare("UPDATE creator_channels SET sync_status='success',total_views=10,total_likes=2,publication_count=1 WHERE id=?").run(channel.id);
  const stored = c.h.sqlite.prepare('SELECT * FROM social_connections WHERE channel_id=?').get(channel.id);
  await c.message('/channels');
  assert.match(c.sent.at(-1).text, /Просмотры: 10/);
  assert.equal(c.buttons()[0].callback_data, 'menu:add-channel');
  assert.deepEqual(c.h.sqlite.prepare('SELECT * FROM social_connections WHERE channel_id=?').get(channel.id), stored);
  c.h.env.YOUTUBE_OAUTH_ENABLED = 'true';
  await c.callback(`social:connect:${channel.id}`);
  assert.ok(c.buttons().some((button) => button.text === 'Войти через Google' && button.url?.startsWith('https://example.test/connect/')));
  assert.equal(c.h.sqlite.prepare('SELECT COUNT(*) n FROM social_connect_tickets').get().n, 1);
  assert.deepEqual(c.h.sqlite.prepare('SELECT * FROM social_connections WHERE channel_id=?').get(channel.id), stored);
});
