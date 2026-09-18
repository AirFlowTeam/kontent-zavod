import test from 'node:test';
import assert from 'node:assert/strict';
import { storageHarness, onboard } from './storage-harness.mjs';
import { createTelegramBotFlow } from '../scripts/telegram-bot-flow.mjs';

const adminId = '1053499153';
function api(h) {
  const POST = h.load('app/api/telegram/route.ts').POST;
  return async (action, fields = {}, authenticated = true) => {
    const response = await POST(new Request('http://localhost/api/telegram', { method: 'POST', headers: {
      'content-type': 'application/json', ...(authenticated ? { 'x-sync-secret': h.env.SYNC_SECRET } : {}),
    }, body: JSON.stringify({ action, ...fields }) }));
    return { status: response.status, body: await response.json() };
  };
}

test('admin capability is server allowlisted, independently of role or client-supplied flag', async (t) => {
  const h = storageHarness(); t.after(h.close); const request = api(h);
  for (const id of [adminId, '2001']) assert.equal((await request('adminRead', { telegramUserId: id, isAdmin: true })).status, 403);
  h.env.TELEGRAM_ADMIN_USER_IDS = adminId;
  assert.equal((await request('adminRead', { telegramUserId: adminId }, false)).status, 401);
  assert.equal((await request('adminRead', { telegramUserId: '2001', isAdmin: true })).status, 403);
  assert.equal((await request('adminRead', { telegramUserId: adminId, chatId: '2001' })).status, 400);
  assert.equal((await request('adminRead', { telegramUserId: adminId })).status, 200);
  assert.equal((await request('context', { telegramUserId: adminId })).body.isAdmin, true);
  assert.equal((await request('context', { telegramUserId: adminId })).body.role, null);
  h.env.TELEGRAM_ADMIN_USER_IDS = 'invalid';
  assert.equal((await request('adminRead', { telegramUserId: adminId })).status, 403);
});

test('admin sees all users and teams, can manage foreign channels but never mint foreign API access', async (t) => {
  const h = storageHarness(); t.after(h.close); h.env.TELEGRAM_ADMIN_USER_IDS = adminId;
  const a = await onboard(h), b = await onboard(h, { producerId: '1002', creatorId: '2002' });
  const s = h.load('db/storage.ts'), request = api(h), admin = { telegramUserId: adminId };
  let id = await s.createChannel({ creatorId: b.context.binding.id, url: 'https://youtube.com/@admin-test-before' });
  await a.flow.getTelegramContext({ telegramUserId: '9999', displayName: 'Not onboarded' });
  const users = await request('adminRead', { ...admin, entity: 'users', page: 0 });
  assert.ok(users.body.items.some((u) => u.telegramUserId === '9999'));
  assert.equal((await request('adminRead', admin)).body.counts.creators, 2);
  assert.equal((await request('adminManageChannel', { telegramUserId: '2001', id, operation: 'pause' })).status, 403);
  const edited = await request('adminManageChannel', { ...admin, id, operation: 'edit', url: 'https://youtube.com/@admin-test-after', creatorId: a.context.binding.id, totalViewsOverride: 999 });
  assert.equal(edited.status, 200); id = edited.body.id;
  const c = h.sqlite.prepare('SELECT creator_id,normalized_url,total_views_override FROM creator_channels WHERE id=?').get(id);
  assert.equal(c.creator_id, b.context.binding.id); assert.equal(c.total_views_override, null); assert.match(c.normalized_url, /after/);
  assert.equal((await request('adminManageChannel', { ...admin, id, operation: 'pause' })).status, 200);
  assert.equal((await request('adminManageChannel', { ...admin, id, operation: 'resume' })).status, 200);
  assert.notEqual((await request('connectSocial', { ...admin, id })).status, 200);
  assert.notEqual((await request('disconnectSocial', { ...admin, id })).status, 200);
  assert.equal((await request('adminManageChannel', { ...admin, id, operation: 'delete' })).status, 200);
  assert.equal((await request('adminRead', { ...admin, entity: 'channels' })).body.total, 0);
  assert.equal((await s.getDashboardData()).creators.length, 2);
});

test('admin invites into selected Telegram-linked team without impersonation; replay remains idempotent', async (t) => {
  const h = storageHarness(); t.after(h.close); h.env.TELEGRAM_ADMIN_USER_IDS = adminId;
  const { context } = await onboard(h), request = api(h);
  const fields = { telegramUserId: adminId, producerId: context.binding.producerId, updateId: 900 };
  const first = await request('adminInvite', fields), second = await request('adminInvite', fields);
  assert.equal(first.status, 200); assert.equal(first.body.invite.token, second.body.invite.token);
  assert.equal(h.sqlite.prepare('SELECT created_by FROM telegram_invites WHERE update_id=900').get().created_by, adminId);
  assert.equal((await request('invite', { ...fields, telegramUserId: '1001' })).status, 403);
  const orphan = await h.load('db/storage.ts').createProducer({ name: 'No Telegram' });
  assert.equal((await request('adminInvite', { ...fields, producerId: orphan, updateId: 901 })).status, 403);
});

test('admin explicitly creates own creator profile once, selects content type, keeps producer and API ownership', async (t) => {
  const h = storageHarness(); t.after(h.close); h.env.TELEGRAM_ADMIN_USER_IDS = adminId;
  const request = api(h), admin = { telegramUserId: adminId };
  assert.equal((await request('adminCreator', admin)).status, 400);
  assert.equal((await request('adminCreator', { telegramUserId: '2001', type: 'AI' })).status, 403);
  const first = await request('adminCreator', { ...admin, type: 'AI' });
  assert.equal(first.status, 200); assert.equal(first.body.canSubmit, true);
  assert.equal(first.body.binding.producerTelegramId, adminId);
  const second = await request('adminCreator', { ...admin, type: 'UGC' });
  assert.equal(second.body.binding.id, first.body.binding.id); assert.equal(second.body.binding.type, 'AI');
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM creators').get().n, 1);
  await request('role', { ...admin, role: 'producer' });
  assert.equal((await request('adminRead', admin)).status, 200);
  assert.equal((await request('adminCreator', admin)).body.canSubmit, true);
  assert.equal(h.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('admin bot menu, editing while producer, stale confirmation and revoked permission checks', async (t) => {
  const h = storageHarness(); t.after(h.close); h.env.TELEGRAM_ADMIN_USER_IDS = adminId;
  const { context } = await onboard(h), s = h.load('db/storage.ts'), request = api(h);
  let id = await s.createChannel({ creatorId: context.binding.id, url: 'https://youtube.com/@ui-before' });
  const sent = [];
  const flow = createTelegramBotFlow({ backend: async (action, fields) => {
    const r = await request(action, fields);
    if (r.status >= 400) throw Object.assign(new Error(r.body.error), { status: r.status });
    return r.body;
  }, send: async (_, text, extra) => sent.push({ text, extra }), answerCallback: async () => {}, processLink: async () => assert.fail('Admin edit must not submit a personal channel'), botUsername: () => 'fixture_bot' });
  let sequence = 1000;
  const from = { id: Number(adminId) }, chat = { id: Number(adminId), type: 'private' };
  const message = (text) => flow.handleMessage({ update_id: ++sequence, message: { from, chat, text } });
  const callback = (data) => flow.handleCallback({ update_id: ++sequence, callback_query: { id: String(sequence), from, message: { chat }, data } });
  const button = (prefix) => sent.at(-1).extra.reply_markup.inline_keyboard.flat().find((b) => b.callback_data?.startsWith(prefix)).callback_data;
  await message('/admin'); assert.match(sent.at(-1).text, /Администратор/);
  await callback('admin:mode:producer');
  await callback(`admin:edit:${id}`); await message('https://youtube.com/@ui-after');
  assert.match(sent.at(-1).text, /Ссылка изменена/);
  id = (await s.getDashboardData()).channels[0].id;
  await callback(`admin:delete:${id}`); const stale = button('admin:confirm-delete:');
  await callback('admin:home'); await callback(stale);
  assert.match(sent.at(-1).text, /старое подтверждение/);
  assert.equal((await s.getDashboardData()).channels.length, 1);
  await callback(`admin:delete:${id}`); const current = button('admin:confirm-delete:');
  h.env.TELEGRAM_ADMIN_USER_IDS = '';
  await assert.rejects(callback(current), /администратору/);
  assert.equal((await s.getDashboardData()).channels.length, 1);
});

test('public guide is self-contained and does not require protected application assets', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const response = await h.load('app/api-guide/route.ts').GET(), html = await response.text();
  assert.equal(response.status, 200); assert.equal(response.headers.has('WWW-Authenticate'), false);
  assert.match(html, /<style>/); assert.doesNotMatch(html, /<script|rel="stylesheet"/);
});

test('admin start and menu cancel a pending personal channel edit', async (t) => {
  for (const command of ['/start', '/admin']) {
    const h = storageHarness(); t.after(h.close); h.env.TELEGRAM_ADMIN_USER_IDS = adminId;
    const { context } = await onboard(h, { creatorId: adminId });
    const s = h.load('db/storage.ts'), request = api(h);
    const id = await s.createChannel({ creatorId: context.binding.id, url: 'https://youtube.com/@keep-original' });
    let submissions = 0;
    const flow = createTelegramBotFlow({ backend: async (action, fields) => {
      const r = await request(action, fields);
      if (r.status >= 400) throw new Error(r.body.error);
      return r.body;
    }, send: async () => {}, answerCallback: async () => {}, processLink: async () => { submissions += 1; }, botUsername: () => 'fixture_bot' });
    const from = { id: Number(adminId) }, chat = { id: Number(adminId), type: 'private' };
    await flow.handleCallback({ update_id: 100, callback_query: { id: '100', from, message: { chat }, data: `channel:edit:${id}` } });
    await flow.handleMessage({ update_id: 101, message: { from, chat, text: command } });
    await flow.handleMessage({ update_id: 102, message: { from, chat, text: 'https://youtube.com/@new-link' } });
    assert.equal(submissions, 1, command);
    assert.equal(h.sqlite.prepare('SELECT normalized_url FROM creator_channels WHERE id=?').get(id).normalized_url, 'https://youtube.com/@keep-original');
  }
});
