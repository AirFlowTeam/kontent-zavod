import test from 'node:test';
import assert from 'node:assert/strict';
import { storageHarness, onboard } from './storage-harness.mjs';
import { createTelegramBotFlow } from '../scripts/telegram-bot-flow.mjs';

const adminId = '1053499153';
async function setup(t, { userId = adminId, externalProducer = false } = {}) {
  const h = storageHarness(); t.after(h.close);
  h.env.TELEGRAM_ADMIN_USER_IDS = adminId;
  h.env.SOCIAL_VAULT_KEY = 'a'.repeat(64);
  h.env.CONTENT_PUBLIC_ORIGIN = 'https://fixture.example';
  const flow = h.load('db/telegram-onboarding.ts'), storage = h.load('db/storage.ts');
  if (externalProducer || userId !== adminId) await onboard(h, { creatorId: userId });
  else await h.load('db/telegram-admin.ts').telegramAdminAction({ action: 'adminCreator', telegramUserId: userId, type: 'UGC' });
  const actor = { telegramUserId: userId };
  const context = await flow.selectTelegramRole({ ...actor, role: 'producer' });
  const submit = h.load('db/telegram.ts').submitTelegramChannel;
  const vault = h.load('db/social-connections.ts');
  return { h, flow, storage, context, actor, submit, vault };
}

test('admin can invite and submit own channels in either stored role, without changing content type or team', async (t) => {
  const { h, flow, storage, context, actor, submit } = await setup(t);
  for (const [i, role] of ['producer', 'creator'].entries()) {
    const current = await flow.selectTelegramRole({ ...actor, role });
    assert.equal(current.dualRole, true); assert.equal(current.canProduce, true); assert.equal(current.canSubmit, true);
    assert.equal(current.producer.id, context.producer.id); assert.equal(current.binding.id, context.binding.id);
    assert.equal(current.binding.type, 'UGC');
    await flow.createTelegramInvite({ ...actor, updateId: 100 + i });
    assert.equal(h.sqlite.prepare('SELECT producer_id FROM telegram_invites WHERE update_id=?').get(100 + i).producer_id, context.producer.id);
    const fields = { ...actor, updateId: 200 + i, sourceKind: 'channel', channelUrl: `https://youtube.com/@self-${role}` };
    const channel = await submit(fields);
    assert.equal(channel.creatorId, context.binding.id);
    assert.equal((await submit({ ...fields, updateId: 300 + i })).id, channel.id);
    assert.equal((await submit(fields)).idempotent, true);
    await flow.manageTelegramChannel({ ...actor, action: 'updateChannel', id: channel.id, status: 'inactive' });
    await flow.manageTelegramChannel({ ...actor, action: 'updateChannel', id: channel.id, status: 'active' });
    assert.equal((await storage.getDashboardData()).telegramAccounts.find((a) => a.telegramUserId === adminId).stage, 'Продюсер и креатор');
  }
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM creators').get().n, 1);
  assert.equal(h.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('own channels stay separate from 50+ team channels, including when own creator belongs to another producer', async (t) => {
  const { h, flow, storage, context, actor, vault } = await setup(t, { externalProducer: true });
  const invite = await flow.createTelegramInvite({ ...actor, updateId: 800 });
  await flow.acceptTelegramInvite({ telegramUserId: '2002', token: invite.token });
  const teammate = await flow.selectTelegramCreatorType({ telegramUserId: '2002', type: 'AI' });
  const own = await storage.createChannel({ creatorId: context.binding.id, url: 'https://youtube.com/@own-separate' });
  for (let i = 0; i < 51; i++) await storage.createChannel({ creatorId: teammate.binding.id, url: `https://youtube.com/@team-${i}` });
  assert.notEqual(context.binding.producerId, context.producer.id);
  assert.deepEqual((await flow.listTelegramChannels(actor)).map((c) => c.id), [own]);
  assert.deepEqual((await flow.listTelegramChannels({ ...actor, scope: 'own' })).map((c) => c.id), [own]);
  const team = await flow.listTelegramChannels({ ...actor, scope: 'team' });
  assert.equal(team.length, 50); assert.ok(team.every((c) => c.creatorTelegramId === '2002'));
  await assert.rejects(vault.createConnectTicket({ ...actor, id: team[0].id, creatorId: teammate.binding.id }), /не найден/);
  assert.ok((await vault.createConnectTicket({ ...actor, id: own })).url);
  h.sqlite.prepare("UPDATE producers SET status='inactive' WHERE id=?").run(context.binding.producerId);
  assert.notEqual((await storage.getDashboardData()).telegramAccounts.find((a) => a.telegramUserId === adminId).stage, 'Продюсер и креатор');
});

test('ordinary producers can submit only their own channels; client flags cannot grant administration or another team', async (t) => {
  const { h, flow, actor, submit, context } = await setup(t, { userId: '2001' });
  const spoof = { ...actor, dualRole: true, canProduce: true, isAdmin: true };
  assert.equal((await flow.getTelegramContext(spoof)).dualRole, false);
  assert.equal((await flow.getTelegramContext(spoof)).canSubmit, true);
  const own = await submit({ ...spoof, updateId: 200, sourceKind: 'channel', channelUrl: 'https://youtube.com/@own-ready' });
  assert.equal(own.creatorId, context.binding.id);
  assert.deepEqual((await flow.listTelegramChannels({ ...spoof, scope: 'own' })).map(c => c.id), [own.id]);
  for (const action of ['adminRead', 'adminManageChannel', 'adminInvite']) {
    await assert.rejects(h.load('db/telegram-admin.ts').telegramAdminAction({ ...spoof, action, id: own.id, operation: 'pause' }), /администратору/);
  }
  await flow.selectTelegramRole({ ...actor, role: 'creator' });
  await assert.rejects(flow.createTelegramInvite({ ...spoof, updateId: 300 }));
  await assert.rejects(flow.listTelegramChannels({ ...spoof, scope: 'team' }));
  await assert.rejects(flow.listTelegramChannels({ ...spoof, scope: 'all' }));
});

test('own API ticket survives role changes and persists encrypted credentials in producer mode', async (t) => {
  const { h, flow, storage, actor, context, vault } = await setup(t);
  const id = await storage.createChannel({ creatorId: context.binding.id, url: 'https://youtube.com/@api-own' });
  const token = (await vault.createConnectTicket({ ...actor, id })).url.split('/').at(-1);
  for (const role of ['creator', 'producer']) {
    await flow.selectTelegramRole({ ...actor, role });
    assert.equal((await vault.connectTicket(token)).creatorId, context.binding.id);
  }
  const ticket = await vault.connectTicket(token);
  h.sqlite.prepare('UPDATE social_connect_tickets SET consumed=1 WHERE token_hash=?').run(ticket.tokenHash);
  await vault.persistConnectedTicket(ticket.tokenHash, { accessToken: 'fixture-private-token' }, { accountId: 'fixture-account' }, null, null);
  const row = h.sqlite.prepare('SELECT telegram_user_id,ciphertext FROM social_connections').get();
  assert.equal(row.telegram_user_id, adminId); assert.ok(row.ciphertext.startsWith('v1.')); assert.ok(!row.ciphertext.includes('fixture-private-token'));
  await vault.disconnectSocial({ ...actor, id });
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM social_connections').get().n, 0);
});

test('revoked admin capability removes administration while preserving ordinary own-channel and API access', async (t) => {
  const { h, flow, storage, actor, context, vault, submit } = await setup(t);
  const id = await storage.createChannel({ creatorId: context.binding.id, url: 'https://youtube.com/@revoke' });
  const token = (await vault.createConnectTicket({ ...actor, id })).url.split('/').at(-1);
  h.env.TELEGRAM_ADMIN_USER_IDS = '';
  assert.equal((await flow.getTelegramContext(actor)).canSubmit, true);
  assert.equal((await flow.getTelegramContext(actor)).dualRole, false);
  const ticket = await vault.connectTicket(token);
  assert.equal(ticket.creatorId, context.binding.id);
  h.sqlite.prepare('UPDATE social_connect_tickets SET consumed=1 WHERE token_hash=?').run(ticket.tokenHash);
  await vault.persistConnectedTicket(ticket.tokenHash, { accessToken: 'fixture-personal-token' }, { accountId: 'fixture-account' }, null, null);
  assert.equal((await submit({ ...actor, updateId: 100, sourceKind: 'channel', channelUrl: 'https://youtube.com/@ordinary-own-write' })).creatorId, context.binding.id);
  for (const action of ['adminRead', 'adminManageChannel', 'adminInvite']) {
    await assert.rejects(h.load('db/telegram-admin.ts').telegramAdminAction({ ...actor, action, id, operation: 'pause' }), /администратору/);
  }
});

test('atomic channel and API writes still reject a creator link removed during the request', async (t) => {
  for (const kind of ['channel', 'api']) {
    const { h, storage, context, actor, vault, submit } = await setup(t);
    const id = await storage.createChannel({ creatorId: context.binding.id, url: 'https://youtube.com/@race' });
    const token = (await vault.createConnectTicket({ ...actor, id })).url.split('/').at(-1);
    const ticket = await vault.connectTicket(token);
    h.sqlite.prepare('UPDATE social_connect_tickets SET consumed=1').run();
    const batch = h.DB.batch.bind(h.DB);
    h.DB.batch = async (items) => {
      h.sqlite.prepare('DELETE FROM telegram_creator_links WHERE telegram_user_id=?').run(adminId);
      return batch(items);
    };
    if (kind === 'api') await assert.rejects(vault.persistConnectedTicket(ticket.tokenHash, { accessToken: 'fixture-token' }, { accountId: 'fixture-account' }, null, null), /изменены/);
    else await assert.rejects(submit({ ...actor, updateId: 100, sourceKind: 'channel', channelUrl: 'https://youtube.com/@race-new' }), /изменены/);
    assert.equal(h.sqlite.prepare('SELECT count(*) n FROM creator_channels').get().n, 1);
    assert.equal(h.sqlite.prepare('SELECT count(*) n FROM social_connections').get().n, 0);
  }
});

test('bot personal menu combines both roles; own API, team scopes and stale role buttons work without switching', async (t) => {
  const { h, context, storage, actor } = await setup(t);
  const id = await storage.createChannel({ creatorId: context.binding.id, url: 'https://youtube.com/@ui-own' });
  const POST = h.load('app/api/telegram/route.ts').POST;
  const calls = [], sent = [], submissions = [];
  const bot = createTelegramBotFlow({ backend: async (action, fields) => {
    calls.push({ action, fields });
    const r = await POST(new Request('http://localhost/api/telegram', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-secret': h.env.SYNC_SECRET }, body: JSON.stringify({ action, ...fields }) }));
    const body = await r.json();
    if (!r.ok) throw Object.assign(new Error(body.error), { status: r.status });
    return body;
  }, send: async (_, text, extra) => sent.push({ text, extra }), answerCallback: async () => {}, processLink: async (...args) => submissions.push(args), botUsername: () => 'fixture_bot' });
  let sequence = 1000;
  const from = { id: Number(adminId) }, chat = { id: Number(adminId), type: 'private' };
  const message = (text) => bot.handleMessage({ update_id: ++sequence, message: { from, chat, text } });
  const callback = (data) => bot.handleCallback({ update_id: ++sequence, callback_query: { id: String(sequence), from, message: { chat }, data } });
  for (const data of ['admin:personal', 'role:creator', 'role:producer', 'menu:roles']) {
    await callback(data);
    assert.match(sent.at(-1).text, /Продюсер · UGC/);
    const buttons = sent.at(-1).extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
    for (const expected of ['menu:add-channel', 'menu:channels', 'menu:team']) assert.ok(buttons.includes(expected));
  }
  await message('/role'); assert.match(sent.at(-1).text, /Продюсер · UGC/);
  assert.equal(calls.some((c) => c.action === 'role'), false);
  await message('/api'); assert.equal(calls.filter((c) => c.action === 'channels').at(-1).fields.scope, 'own');
  assert.ok(JSON.stringify(sent.at(-1)).includes(`social:connect:${id}`));
  await callback('menu:team-channels'); assert.equal(calls.filter((c) => c.action === 'channels').at(-1).fields.scope, 'team');
  await message('https://youtube.com/@another-own'); assert.equal(submissions.length, 1);
  await message('/invite'); assert.ok(calls.some((c) => c.action === 'invite' && c.fields.telegramUserId === actor.telegramUserId));
  h.sqlite.prepare('UPDATE telegram_creator_links SET type_confirmed_at=NULL WHERE telegram_user_id=?').run(adminId);
  h.sqlite.prepare('UPDATE telegram_accounts SET selected_type=NULL WHERE telegram_user_id=?').run(adminId);
  await message('/profile');
  assert.match(sent.at(-1).text, /контент/);
  assert.ok(JSON.stringify(sent.at(-1)).includes('type:UGC'));
  await callback('type:UGC');
  assert.match(sent.at(-1).text, /Продюсер · UGC/);
  await callback('type:AI');
  assert.match(sent.at(-1).text, /UGC/);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM creators').get().n, 1);
  h.sqlite.prepare("UPDATE creators SET status='inactive' WHERE id=?").run(context.binding.id);
  await message('/profile');
  assert.match(sent.at(-1).text, /Профиль отключён/);
  assert.ok(!JSON.stringify(sent.at(-1)).includes('admin:mode:creator'));
});
