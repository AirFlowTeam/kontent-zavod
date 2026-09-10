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
  await message(2001, '/channels'); assert.match(sent.at(-1).text, /Telegram ID 1001/); assert.match(sent.at(-1).text, /Telegram ID 2001/);
  await message(1001, '/creators'); assert.match(sent.at(-1).text, /каналов: 1/);
  await message(1001, 'https://youtube.com/@other'); assert.equal(links.length, 1);
  await callback(2001, 'role:producer');
  await callback(2001, 'role:creator'); assert.match(sent.at(-1).text, /ИИ-контент/);
  await callback(2001, 'bind:999'); assert.match(sent.at(-1).text, /устарела/);
  const before = sent.length;
  await flow.handleMessage({ update_id: ++update, message: { from: { id: 2001 }, chat: { id: -100, type: 'group' }, text: '/start' } });
  assert.equal(sent.length, before);
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
  for (const id of ['2001', '2002']) {
    await f.selectTelegramRole({ telegramUserId: id, role: 'creator' });
    await f.selectTelegramCreatorType({ telegramUserId: id, type: 'UGC' });
  }
  await f.acceptTelegramInvite({ telegramUserId: '2001', token: a.token });
  assert.equal((await f.createTelegramInvite({ telegramUserId: '1001', updateId: 1, creatorId })).token, a.token);
  await assert.rejects(f.acceptTelegramInvite({ telegramUserId: '2002', token: b.token }), /занят/);
  assert.equal(h.sqlite.prepare('SELECT redeemed_by FROM telegram_invites WHERE update_id = 2').get().redeemed_by, null);
});
