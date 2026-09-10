import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramBotFlow } from '../scripts/telegram-bot-flow.mjs';
import { storageHarness, onboard } from './storage-harness.mjs';

test('full bot conversation: producer, personal invitation, AI creator, link, channels, role switch', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const sent = [];
  const links = [];
  const POST = h.load('app/api/telegram/route.ts').POST;
  async function backend(action, data) {
    const response = await POST(new Request('http://localhost/api/telegram', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-secret': h.env.SYNC_SECRET }, body: JSON.stringify({ action, ...data }) }));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    return payload;
  }
  const flow = createTelegramBotFlow({ backend, send: async (id, text, extra) => sent.push({ id, text, extra }),
    answerCallback: async () => {}, botUsername: () => 'fixture_bot',
    processLink: async (id, user, updateId, url) => {
      links.push(url);
      return backend('submit', { telegramUserId: String(user.id), updateId, sourceKind: 'channel', channelUrl: url });
    } });
  let update = 0;
  const message = (id, text) => flow.handleMessage({ update_id: ++update, message: { from: { id, first_name: 'Name' }, chat: { id, type: 'private' }, text } });
  const callback = (id, data) => flow.handleCallback({ update_id: ++update, callback_query: { id: String(update), from: { id, first_name: 'Name' }, message: { chat: { id, type: 'private' } }, data } });
  await message(1001, '/start'); assert.match(sent.at(-1).text, /Выберите свою роль/);
  await callback(1001, 'role:producer');
  await callback(1001, 'invite:new');
  const token = sent.at(-1).text.match(/start=(c_[a-f0-9]+)/)[1];
  await message(2001, `/start ${token}`); assert.match(sent.at(-1).text, /один раз/);
  await message(2001, 'https://youtube.com/@fixture'); assert.equal(links.length, 0);
  await callback(2001, 'type:AI'); assert.match(sent.at(-1).text, /раз в сутки/);
  await message(2001, 'https://youtube.com/@fixture'); assert.equal(links.length, 1);
  await message(2001, '/channels'); assert.match(sent.at(-2).text, /Telegram ID 1001/); assert.match(sent.at(-2).text, /Telegram ID 2001/);
  assert.match(sent.at(-2).text, /Просмотры:.*\nРолики:.*\nЛайки:/);
  assert.ok(sent.at(-1).extra.reply_markup.inline_keyboard.length);
  await message(1001, '/creators'); assert.match(sent.at(-1).text, /каналов: 1/);
  assert.ok(sent.at(-1).extra.reply_markup.inline_keyboard.some((row) => row.some((b) => b.callback_data === 'menu:home')));
  await message(1001, 'https://youtube.com/@other'); assert.equal(links.length, 1);
  assert.match(sent.at(-1).text, /Каналы добавляет сам креатор/);
  await message(2001, 'https://youtube.com/@first https://youtube.com/@second');
  assert.equal(links.length, 1);
  assert.match(sent.at(-1).text, /каждую ссылку отдельным сообщением/);
  await callback(2001, 'role:producer');
  assert.equal((await backend('context', { telegramUserId: '2001' })).role, 'creator');
  assert.match(sent.at(-1).text, /Переключиться/);
  await callback(2001, 'confirm-role:producer');
  await callback(2001, 'type:UGC');
  assert.equal((await backend('context', { telegramUserId: '2001' })).role, 'producer');
  await callback(2001, 'role:creator');
  await callback(2001, 'confirm-role:creator'); assert.match(sent.at(-1).text, /ИИ-контент/);
  await callback(2001, 'bind:999'); assert.match(sent.at(-1).text, /устарела/);
  const before = sent.length;
  await flow.handleMessage({ update_id: ++update, message: { from: { id: 2001 }, chat: { id: -100, type: 'group' }, text: '/start' } });
  assert.equal(sent.length, before);
});

test('creator onboarding without invite gives guidance and navigation; own invite never switches producer role', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const f = h.load('db/telegram-onboarding.ts');
  const sent = [];
  const flow = createTelegramBotFlow({ backend: async (action, data) => action === 'role' ? f.selectTelegramRole(data) : f.getTelegramContext(data),
    send: async (_, text, extra) => sent.push({ text, extra }), answerCallback: async () => {}, processLink: async () => {}, botUsername: () => 'fixture' });
  await flow.handleCallback({ update_id: 1, callback_query: { id: '1', from: { id: 2001 }, message: { chat: { id: 2001, type: 'private' } }, data: 'role:creator' } });
  assert.match(sent.at(-1).text, /личную ссылку/);
  assert.ok(sent.at(-1).extra.reply_markup.inline_keyboard.length >= 2);
  assert.equal((await f.getTelegramContext({ telegramUserId: '2001' })).selectedType, null);
  await assert.rejects(f.selectTelegramCreatorType({ telegramUserId: '2001', type: 'AI' }), /приглашение/);
  await f.selectTelegramRole({ telegramUserId: '1001', role: 'producer' });
  const invite = await f.createTelegramInvite({ telegramUserId: '1001', updateId: 1 });
  const context = await f.acceptTelegramInvite({ telegramUserId: '1001', token: invite.token });
  assert.equal(context.ownInvite, true);
  assert.equal(context.role, 'producer');
});

test('duplicates are idempotent and another creator cannot alter an existing channel', async (t) => {
  const h = storageHarness(); t.after(h.close);
  await onboard(h);
  await onboard(h, { producerId: '1002', creatorId: '2002' });
  const submit = h.load('db/telegram.ts').submitTelegramChannel;
  const body = { telegramUserId: '2001', updateId: 1, sourceKind: 'channel', channelUrl: 'https://youtube.com/@fixture', handle: '@fixture' };
  const first = await submit(body);
  assert.equal((await submit(body)).idempotent, true);
  const other = await submit({ ...body, telegramUserId: '2002', updateId: 2, handle: '@tampered' });
  assert.equal(other.creatorMatch, false);
  assert.equal(other.creatorName, null);
  assert.equal(h.sqlite.prepare('SELECT handle FROM creator_channels WHERE id = ?').get(first.id).handle, '@fixture');
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM creator_channels').get().n, 1);
});

test('legacy multiple links cannot overwrite confirmed creator type', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const { flow, context } = await onboard(h, { type: 'AI' });
  h.sqlite.prepare(`INSERT INTO telegram_creator_links(telegram_user_id, creator_id, chat_id, created_at, updated_at)
    VALUES ('2002', ?, '2002', '2026-01-01', '2026-01-01')`).run(context.binding.id);
  await assert.rejects(flow.selectTelegramCreatorType({ telegramUserId: '2002', type: 'UGC' }), /уже подтверждён/);
  assert.equal(h.sqlite.prepare('SELECT type FROM creators WHERE id = ?').get(context.binding.id).type, 'AI');
  assert.equal((await flow.getTelegramContext({ telegramUserId: '2002' })).canSubmit, false);
});

test('occupied target invitation does not get consumed; original invite delivery retries safely', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const f = h.load('db/telegram-onboarding.ts');
  const context = await f.selectTelegramRole({ telegramUserId: '1001', role: 'producer' });
  const result = h.sqlite.prepare("INSERT INTO creators(name, type, producer_id, status, created_at) VALUES ('Pending', 'UGC', ?, 'active', '2026-01-01')").run(context.producer.id);
  const creatorId = Number(result.lastInsertRowid);
  const a = await f.createTelegramInvite({ telegramUserId: '1001', updateId: 1, creatorId });
  const b = await f.createTelegramInvite({ telegramUserId: '1001', updateId: 2, creatorId });
  await f.acceptTelegramInvite({ telegramUserId: '2001', token: a.token });
  await f.selectTelegramCreatorType({ telegramUserId: '2001', type: 'UGC' });
  assert.equal((await f.createTelegramInvite({ telegramUserId: '1001', updateId: 1, creatorId })).token, a.token);
  await f.acceptTelegramInvite({ telegramUserId: '2002', token: b.token });
  await assert.rejects(f.selectTelegramCreatorType({ telegramUserId: '2002', type: 'UGC' }), /занят/);
  assert.equal(h.sqlite.prepare('SELECT redeemed_by FROM telegram_invites WHERE update_id = 2').get().redeemed_by, null);
});
