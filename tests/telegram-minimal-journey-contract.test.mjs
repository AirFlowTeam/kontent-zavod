import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramBotFlow } from '../scripts/telegram-bot-flow.mjs';
import { socialInstructions } from '../lib/social-instructions.mjs';

const makeChannel = (id, fields = {}) => ({ id, platformName: 'YouTube', creatorTelegramId: '2001',
  creatorName: 'Fixture', url: `https://youtube.com/@fixture${id}`, status: 'active', syncStatus: 'needs_auth',
  connectionStatus: null, totalViews: null, publicationCount: null, totalLikes: null, ...fields });
const ready = { syncStatus: 'success', connectionStatus: 'connected', totalViews: 0, publicationCount: 0, totalLikes: 0 };

function conversation(options = {}) {
  let items = options.channels || [makeChannel(12)];
  const context = { role: 'creator', canSubmit: true, canProduce: false, isAdmin: false, dualRole: false,
    binding: { id: 7, name: 'Fixture', type: 'UGC', typeConfirmedAt: '2026-09-17', creatorStatus: 'active', producerStatus: 'active' },
    ...options.context };
  const calls = [], sent = [];
  let sequence = 0;
  const flow = createTelegramBotFlow({ backend: async (action, fields) => {
    calls.push({ action, fields });
    if (action === 'context') return context;
    if (action === 'channels') return { channels: items };
    if (action === 'journey') return { journey: { skippedPlatforms: [] }, setup: options.setup || ['YouTube', 'VK', 'Instagram', 'Threads', 'TikTok'].map((platformName) => ({ platformName, available: true })) };
    if (action === 'connectSocial') {
      assert.ok(items.some((item) => item.id === fields.id && item.creatorTelegramId === fields.telegramUserId));
      return { connection: { platformName: items.find((item) => item.id === fields.id).platformName, url: `https://fixture.example/connect/${fields.id}` } };
    }
    // Makes the old admin /start interception observable instead of throwing.
    if (action === 'adminRead') return { counts: { users: 1, creators: 1, producers: 1, channels: 1 } };
    throw new Error(`Unexpected backend action ${action}`);
  }, send: async (_, text, extra) => sent.push({ text, extra }), answerCallback: async () => {}, botUsername: () => 'fixture_bot',
  processLink: async () => {
    const channel = options.submitted || makeChannel(22);
    if (!items.some((item) => item.id === channel.id)) items = [...items, channel];
    return { channel: { ...channel, creatorMatch: true, resultStatus: 'created' } };
  } });
  const message = (text) => flow.handleMessage({ update_id: ++sequence, message: { from: { id: 2001 }, chat: { id: 2001, type: 'private' }, text } });
  const callback = (data) => flow.handleCallback({ update_id: ++sequence, callback_query: { id: String(sequence), from: { id: 2001 }, message: { chat: { id: 2001, type: 'private' } }, data } });
  const buttons = () => sent.at(-1)?.extra?.reply_markup?.inline_keyboard?.flat() || [];
  const callbacks = () => buttons().map((button) => button.callback_data).filter(Boolean);
  return { calls, sent, message, callback, buttons, callbacks, update: (id, fields) => { items = items.map((item) => item.id === id ? { ...item, ...fields } : item); } };
}

test('ordinary start is a minimal home while guide resumes the first unfinished owned channel', async () => {
  const c = conversation({ channels: [makeChannel(10, ready), makeChannel(12), makeChannel(13)] });
  await c.message('/start');
  assert.ok(c.callbacks().includes('menu:add-channel')); assert.ok(c.callbacks().includes('menu:channels'));
  assert.ok(c.buttons().length <= 3);
  await c.message('/guide');
  assert.ok(c.callbacks().includes('social:connect:12'));
  assert.equal(c.callbacks().some((value) => value.includes(':13') || value.startsWith('journey:skip:')), false);
  assert.equal(c.calls.some((call) => call.action === 'setJourneyPlatform'), false);
});

test('newly saved channel takes focus even if an older channel is still unfinished', async () => {
  const c = conversation({ channels: [makeChannel(12)], submitted: makeChannel(22) });
  await c.message('https://youtube.com/@fixture22');
  assert.ok(c.callbacks().includes('social:connect:22'));
  assert.equal(c.callbacks().includes('social:connect:12'), false);
  assert.ok(c.buttons().length <= 3);
  assert.equal(c.sent.filter((item) => (item.extra?.reply_markup?.inline_keyboard?.flat() || []).some((button) => button.callback_data === 'social:connect:22')).length, 1);
});

test('one channel moves from official login to pending read-only refresh to completed add-another', async () => {
  const c = conversation();
  await c.message('/channels');
  assert.ok(c.callbacks().includes('social:connect:12'));
  await c.callback('social:connect:12');
  assert.ok(c.buttons().some((button) => button.url === 'https://fixture.example/connect/12'));
  assert.ok(c.callbacks().includes('channel:show:12'));
  c.update(12, { connectionStatus: 'connected', syncStatus: 'pending' });
  await c.callback('channel:show:12');
  assert.ok(c.callbacks().includes('channel:show:12'));
  assert.equal(c.calls.some((call) => call.action === 'recheckChannel'), false);
  c.update(12, ready); await c.callback('channel:show:12');
  assert.equal(c.callbacks()[0], 'menu:add-channel');
  assert.ok(c.buttons().length <= 3);
  assert.equal(c.callbacks().some((value) => value.startsWith('journey:skip:')), false);
});

test('own settings are separate from a three-action card and cannot be opened for a foreign id', async () => {
  const c = conversation();
  await c.message('/channels');
  assert.ok(c.buttons().length <= 3);
  assert.ok(c.callbacks().includes('channel:settings:12'));
  assert.equal(c.callbacks().some((value) => /^channel:(delete|edit|pause):/.test(value) || value.startsWith('social:disconnect:')), false);
  await c.callback('channel:settings:99');
  assert.equal(c.callbacks().some((value) => value.endsWith(':99')), false);
  assert.equal(c.calls.some((call) => ['connectSocial', 'updateChannel', 'deleteChannel'].includes(call.action)), false);
});

test('channel-specific help retains its channel id through each step and opens that personal form', async () => {
  const c = conversation({ channels: [makeChannel(12), makeChannel(22)] });
  await c.callback('channel:help:22');
  for (let index = 1; index < socialInstructions.YouTube.steps.length; index++) {
    assert.ok(c.callbacks().includes(`access:step:22:${index}`));
    assert.ok(c.buttons().length <= 3);
    await c.callback(`access:step:22:${index}`);
  }
  assert.ok(c.callbacks().includes('social:connect:22'));
  assert.ok(c.callbacks().includes('channel:show:22'));
});

test('RuTube help ends at collection or results, never a nonexistent credential flow', async () => {
  const c = conversation({ channels: [makeChannel(12, { ...ready, platformName: 'RuTube', connectionStatus: null, totalLikes: null })] });
  await c.callback(`access:step:12:${socialInstructions.RuTube.steps.length - 1}`);
  assert.equal(c.callbacks().includes('social:connect:12'), false);
  assert.ok(c.callbacks().some((value) => ['channel:show:12', 'channel:check:12'].includes(value)));
});

test('the actual form-return start payload resumes work and is not parsed as an invalid invitation', async () => {
  const c = conversation({ channels: [makeChannel(12, { connectionStatus: 'connected', syncStatus: 'pending' })] });
  await c.message('/start check');
  assert.ok(c.calls.some((call) => call.action === 'channels'), 'form return must read the saved channel');
  assert.ok(c.callbacks().includes('channel:show:12'));
  assert.equal(c.calls.some((call) => call.action === 'acceptInvite'), false);
  assert.equal(c.callbacks().includes('menu:invite-help'), false);
});

test('an admin starts in the same minimal personal journey; administration stays behind /admin', async () => {
  const c = conversation({ context: { role: 'producer', isAdmin: true, dualRole: true, canProduce: true, producer: { status: 'active' } } });
  await c.message('/start');
  assert.equal(c.calls.some((call) => call.action === 'adminRead'), false);
  assert.ok(c.callbacks().includes('menu:add-channel'));
  assert.ok(c.buttons().length <= 3);
});


test('form return selects the exact owned channel and cannot open a foreign channel', async () => {
  const c = conversation({ channels: [makeChannel(12), makeChannel(22, { connectionStatus: 'connected', syncStatus: 'pending' })] });
  await c.message('/start check_22');
  assert.ok(c.callbacks().includes('channel:show:22'));
  assert.equal(c.callbacks().includes('social:connect:12'), false);
  await c.message('https://t.me/fixture_bot?start=check_22');
  assert.ok(c.callbacks().includes('channel:show:22'));
  await c.message('/start check_99');
  assert.equal(c.callbacks().some((v) => v.endsWith(':99')), false);
  assert.equal(c.calls.some((call) => call.action === 'acceptInvite'), false);
});

test('only explicitly available official login gets a URL, for either own-channel role', async () => {
  for (const role of ['creator', 'producer']) {
    for (const platformName of ['YouTube', 'Instagram', 'Threads', 'TikTok', 'VK']) {
      const c = conversation({ context: { role, canProduce: role === 'producer' }, channels: [makeChannel(12, { platformName })] });
      await c.callback('social:connect:12');
      assert.equal(c.calls.filter((call) => call.action === 'connectSocial').length, 1);
      assert.ok(c.buttons().some((button) => button.url === 'https://fixture.example/connect/12'
        && button.text === `Войти через ${platformName === 'YouTube' ? 'Google' : platformName}`));
      assert.ok(c.buttons().length <= 3);
      assert.doesNotMatch(c.sent.at(-1).text, /Google Cloud|API-ключ|вставьте ключ|Credentials/);
    }
  }
});

test('disabled and unknown official login remain actionable without minting a ticket or promising login', async () => {
  for (const platformName of ['YouTube', 'Instagram', 'Threads', 'TikTok', 'VK']) {
    for (const setup of [[], [{ platformName, available: false, reason: 'Вход ещё не включён. Администратор проверяет приложение.' }]]) {
      const c = conversation({ channels: [makeChannel(12, { platformName })], setup });
      await c.callback('social:connect:12');
      assert.equal(c.calls.some((call) => call.action === 'connectSocial'), false);
      assert.equal(c.buttons().some((button) => button.url), false);
      assert.ok(c.callbacks().includes('social:connect:12'));
      assert.ok(c.callbacks().includes(`social:file:${platformName}`));
      assert.ok(c.callbacks().includes('channel:show:12'));
      assert.ok(c.buttons().length <= 3);
      assert.match(c.sent.at(-1).text, /не включён|Не удалось подтвердить/);
    }
  }
});

test('legacy connect callbacks cannot create fake RuTube login or a foreign-channel ticket', async () => {
  const c = conversation({ channels: [makeChannel(12, { ...ready, platformName: 'RuTube', connectionStatus: null, totalLikes: null })] });
  await c.callback('social:connect:12');
  assert.equal(c.buttons().some((button) => button.url || button.callback_data?.startsWith('social:connect:')), false);
  await c.callback('social:personal:99');
  assert.equal(c.calls.some((call) => call.action === 'connectSocial' || call.action === 'journey'), false);
  assert.equal(c.buttons().some((button) => button.url), false);
});
