import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramBotFlow } from '../scripts/telegram-bot-flow.mjs';
import { containsGoogleApiKey } from '../scripts/telegram-google-key.mjs';
import { channelSubmissionReceipt } from '../scripts/telegram-channel-receipt.mjs';
import { storageHarness, onboard } from './storage-harness.mjs';

// Synthetic shape only; never a working credential.
const key = `AIza${'x'.repeat(35)}`;
const channel = (id = 1, extra = {}) => ({ id, platformName: 'YouTube', creatorTelegramId: '2001',
  status: 'active', title: `Canal ${id}`, url: `https://youtube.com/@fixture${id}`, ...extra });

function fixture({ own = [channel()], context = { role: 'creator', canSubmit: true }, setup = [{ platformName: 'YouTube', available: true, sharedKeyConfigured: false }], backend: override } = {}) {
  const sent = [], calls = [], links = [];
  const backend = async (action, fields) => {
    calls.push({ action, fields });
    if (override) return override(action, fields);
    if (action === 'context') return context;
    if (action === 'channels') return { channels: own };
    if (action === 'connectSocial') return { connection: { platformName: 'YouTube', url: `https://example.test/connect/fixture-${fields.id}` } };
    if (action === 'journey') return { journey: { skippedPlatforms: [] }, setup };
    if (action === 'adminRead') return { item: { creatorName: 'Fixture', normalizedUrl: own[0]?.url } };
    throw new Error(`Unexpected mutation: ${action}`);
  };
  const flow = createTelegramBotFlow({ backend, send: async (chat, text, extra) => sent.push({ chat, text, extra }),
    answerCallback: async () => {}, botUsername: () => 'fixture_bot', processLink: async (...args) => links.push(args) });
  const message = (fields) => flow.handleMessage({ update_id: 10, message: {
    message_id: 10, from: { id: 2001 }, chat: { id: 2001, type: 'private' }, ...fields,
  } });
  const callback = (data) => flow.handleCallback({ update_id: 11, callback_query: {
    id: '11', from: { id: 2001 }, message: { chat: { id: 2001, type: 'private' } }, data,
  } });
  const buttons = () => sent.at(-1).extra.reply_markup.inline_keyboard.flat();
  return { sent, calls, links, message, callback, buttons };
}

test('recognizes only a complete Google key, including captions and hidden links', () => {
  for (const message of [{ text: key }, { text: `API: ${key}\nhttps://youtube.com/@fixture` },
    { caption: key }, { text: 'link', entities: [{ url: `https://example.test/?key=${key}` }] },
    { caption: 'link', caption_entities: [{ url: `https://example.test/?key=${key}` }] }]) {
    assert.equal(containsGoogleApiKey(message), true);
  }
  for (const text of ['https://youtube.com/@ordinary', `prefix${key}`, `${key}suffix`, 'AIza-short', '/api']) {
    assert.equal(containsGoogleApiKey({ text }), false);
  }
});

test('a pasted key bypasses link processing and opens the only own YouTube form without forwarding the key', async () => {
  const c = fixture({ own: [channel(9, { creatorTelegramId: '9999' }), channel(1), channel(2, { platformName: 'VK' })] });
  await c.message({ text: `https://youtube.com/@should-not-submit?key=${key}` });
  assert.equal(c.links.length, 0);
  assert.deepEqual(c.calls.map((item) => item.action), ['context', 'channels', 'journey', 'connectSocial']);
  assert.equal(c.calls.at(-1).fields.id, 1);
  assert.equal(c.calls[1].fields.scope, 'own');
  assert.match(c.sent.at(-1).text, /Ключ из сообщения не подключён/);
  assert.ok(c.buttons().some((button) => button.text === 'Войти через Google'));
  assert.doesNotMatch(c.sent.at(-1).text, /вставьте ключ|Google Cloud|Credentials/i);
  assert.ok(c.buttons().some((button) => button.url === 'https://example.test/connect/fixture-1'));
  assert.ok(!JSON.stringify([c.calls, c.sent, c.links]).includes(key));
});

test('a pasted caption key opens a paused channel form with a resume action', async () => {
  const c = fixture({ own: [channel(1, { status: 'inactive' })] });
  await c.message({ caption: key });
  assert.ok(c.buttons().some((button) => button.callback_data === 'channel:resume:1'));
  assert.match(c.sent.at(-1).text, /Затем нажмите «Возобновить сбор»/);
  assert.ok(!JSON.stringify(c.sent).includes(key));
});

test('a pasted key cannot bypass disabled Google login or become a stored credential', async () => {
  const c = fixture({ setup: [{ platformName: 'YouTube', available: false, reason: 'Администратор ещё не настроил вход YouTube.' }] });
  await c.message({ text: key });
  assert.equal(c.links.length, 0);
  assert.equal(c.calls.some((item) => item.action === 'connectSocial'), false);
  assert.equal(c.buttons().some((button) => button.url), false);
  assert.ok(c.buttons().some((button) => button.callback_data === 'social:connect:1'));
  assert.match(c.sent.at(-1).text, /Администратор/);
  assert.ok(!JSON.stringify([c.calls, c.sent]).includes(key));
});

test('multiple own YouTube channels require a choice; paging retains the last channels and never chooses for the user', async () => {
  const c = fixture({ own: Array.from({ length: 22 }, (_, i) => channel(i + 1)) });
  await c.message({ text: key });
  assert.equal(c.calls.filter((item) => item.action === 'connectSocial').length, 0);
  assert.equal(c.buttons().filter((button) => button.callback_data?.startsWith('social:personal:')).length, 20);
  await c.callback('youtube:keys:1');
  assert.ok(c.buttons().some((button) => button.callback_data === 'social:personal:22'));
  await c.callback('social:personal:22');
  assert.equal(c.calls.at(-1).fields.id, 22);
  assert.ok(c.buttons().some((button) => button.url === 'https://example.test/connect/fixture-22'));
  assert.ok(!JSON.stringify([c.calls, c.sent]).includes(key));
});

test('a key never mints access for a team channel, a missing channel or an unbound user', async () => {
  const foreign = fixture({ own: [channel(9, { creatorTelegramId: '9999' })] });
  await foreign.message({ text: key });
  assert.match(foreign.sent.at(-1).text, /Сначала пришлите ссылку/);
  assert.equal(foreign.calls.some((item) => item.action === 'connectSocial'), false);
  const unbound = fixture({ context: { role: null, canSubmit: false } });
  await unbound.message({ text: key });
  assert.equal(unbound.calls.some((item) => item.action === 'channels' || item.action === 'connectSocial'), false);
  assert.ok(!JSON.stringify([foreign.calls, foreign.sent, unbound.calls, unbound.sent]).includes(key));
});

test('a key aborts pending creator and admin edits before either handler can submit its mixed URL', async () => {
  for (const callback of ['channel:edit:1', 'admin:edit:1']) {
    const c = fixture();
    await c.callback(callback);
    await c.message({ text: `https://youtube.com/@new?key=${key}` });
    assert.equal(c.calls.some((item) => ['updateChannel', 'adminManageChannel'].includes(item.action)), false);
    await c.message({ text: 'just text' });
    assert.doesNotMatch(c.sent.at(-1).text, /новую ссылку|одну новую ссылку/);
    assert.equal(c.links.length, 0);
    assert.ok(!JSON.stringify([c.calls, c.sent]).includes(key));
  }
});

test('normal channel links still reach submission, and group messages never start credential routing', async () => {
  const c = fixture();
  await c.message({ text: 'https://youtube.com/@ordinary' });
  assert.equal(c.links.length, 1);
  const group = fixture();
  await group.message({ text: key, chat: { id: -100, type: 'group' } });
  assert.equal(group.calls.length, 0); assert.equal(group.sent.length, 0);
});

test('real owner-bound ticket is created but a pasted key is never saved as a connection', async (t) => {
  const h = storageHarness(); t.after(h.close); await onboard(h);
  h.env.CONTENT_PUBLIC_ORIGIN = 'https://example.test'; h.env.SOCIAL_VAULT_KEY = 'ab'.repeat(32);
  h.env.YOUTUBE_CLIENT_ID = 'fixture-client-id'; h.env.YOUTUBE_CLIENT_SECRET = 'fixture-client-secret'; h.env.YOUTUBE_OAUTH_ENABLED = 'true';
  const submit = h.load('db/telegram.ts').submitTelegramChannel;
  const saved = await submit({ telegramUserId: '2001', updateId: 1, sourceKind: 'channel', channelUrl: 'https://youtube.com/@fixture' });
  const POST = h.load('app/api/telegram/route.ts').POST;
  const c = fixture({ backend: async (action, fields) => {
    const response = await POST(new Request('http://localhost/api/telegram', { method: 'POST', headers: {
      'content-type': 'application/json', 'x-sync-secret': h.env.SYNC_SECRET,
    }, body: JSON.stringify({ action, ...fields }) }));
    const body = await response.json(); assert.equal(response.status, 200, body.error); return body;
  } });
  await c.message({ text: key });
  const ticket = h.sqlite.prepare('SELECT channel_id, telegram_user_id FROM social_connect_tickets').get();
  assert.equal(ticket.channel_id, saved.id); assert.equal(ticket.telegram_user_id, '2001');
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM social_connections').get().n, 0);
  assert.ok(c.buttons().some((button) => button.url?.startsWith('https://example.test/connect/')));
  assert.ok(!JSON.stringify([c.calls, c.sent]).includes(key));
});

test('new and duplicate YouTube link receipts lead to official Google login', () => {
  for (const resultStatus of ['created', 'existing']) {
    const receipt = channelSubmissionReceipt({ id: 12, platformName: 'YouTube', creatorMatch: true, status: 'active',
      resultStatus, creatorName: 'Fixture', normalizedUrl: 'https://youtube.com/@fixture' });
    const buttons = receipt.extra.reply_markup.inline_keyboard.flat();
    assert.equal(buttons[0].callback_data, 'social:connect:12');
    assert.equal(buttons.some((button) => button.callback_data === 'channel:check:12'), false);
    assert.doesNotMatch(receipt.text, /подключите личный доступ/);
    if (resultStatus === 'created') assert.match(receipt.text, /войдите через Google аккаунтом владельца/);
  }
  for (const values of [{ status: 'deleted' }, { status: 'inactive' }, { status: 'active', creatorMatch: false }]) {
    const receipt = channelSubmissionReceipt({ platformName: 'YouTube', creatorMatch: true, resultStatus: 'existing', ...values });
    assert.equal(receipt.extra, undefined);
  }
  const instagram = channelSubmissionReceipt({ id: 2, platformName: 'Instagram', creatorMatch: true, resultStatus: 'created' });
  assert.match(instagram.text, /подключите личный доступ/);
  assert.equal(instagram.extra.reply_markup.inline_keyboard[0][0].callback_data, 'social:connect:2');
});
