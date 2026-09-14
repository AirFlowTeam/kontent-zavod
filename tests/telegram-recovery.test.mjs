import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramBotFlow } from '../scripts/telegram-bot-flow.mjs';
import { invitationFromMessage } from '../scripts/telegram-invitation.mjs';
import { storageHarness, onboard } from './storage-harness.mjs';

function conversation(h) {
  const sent = [];
  const POST = h.load('app/api/telegram/route.ts').POST;
  const flow = createTelegramBotFlow({ backend: async (action, fields) => {
    const response = await POST(new Request('http://localhost/api/telegram', { method: 'POST', headers: {
      'content-type': 'application/json', 'x-sync-secret': h.env.SYNC_SECRET,
    }, body: JSON.stringify({ action, ...fields }) }));
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
    return result;
  }, send: async (_, text, extra) => sent.push({ text, extra }), answerCallback: async () => {}, processLink: async () => {}, botUsername: () => 'fixture_bot' });
  let sequence = 500;
  const message = (text, more = {}) => flow.handleMessage({ update_id: ++sequence,
    message: { from: { id: 2001 }, chat: { id: 2001, type: 'private' }, text, ...more } });
  const callback = (data) => flow.handleCallback({ update_id: ++sequence, callback_query: { id: String(sequence),
    from: { id: 2001 }, message: { chat: { id: 2001, type: 'private' } }, data } });
  const button = (prefix) => sent.at(-1).extra.reply_markup.inline_keyboard.flat().find((b) => b.callback_data?.startsWith(prefix)).callback_data;
  return { sent, message, callback, button };
}

test('own pasted/forwarded invites and start payloads accepted, wrong bot/host/ambiguous invites rejected', () => {
  const token = 'a'.repeat(48), link = `https://t.me/fixture_bot?start=c_${token}`;
  for (const text of [link, `/start ${link}`, `/start c_${token}`, `c_${token}`, `Приглашение: ${link}`]) {
    assert.equal(invitationFromMessage({ text }, 'fixture_bot').token, token);
  }
  assert.equal(invitationFromMessage({ text: 'Вход', entities: [{ type: 'text_link', url: link }] }, 'fixture_bot').token, token);
  for (const url of [link.replace('t.me/', 't.me.evil/'), link.replace('fixture_bot', 'other_bot'), link.replace('https://', 'https://user:pass@')]) {
    assert.equal(invitationFromMessage({ text: url }, 'fixture_bot'), null);
  }
  assert.equal(invitationFromMessage({ text: '/start old-token' }, 'fixture_bot').kind, 'invalid');
  assert.equal(invitationFromMessage({ text: `${link} ${link.replace(token, 'b'.repeat(48))}` }, 'fixture_bot').kind, 'multiple');
});
test('pasted invitation survives repeated role/start/type clicks and stale role confirmation cannot undo onboarding', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const f = h.load('db/telegram-onboarding.ts');
  await f.selectTelegramRole({ telegramUserId: '1001', role: 'producer' });
  const invite = await f.createTelegramInvite({ telegramUserId: '1001', updateId: 1 });
  const c = conversation(h);
  await c.message('/start');
  await c.callback('role:creator');
  await c.callback('role:producer');
  const oldConfirmation = c.button('confirm-role:');
  await c.callback('menu:home');
  await c.message(`https://t.me/fixture_bot?start=c_${invite.token}`);
  for (let n = 0; n < 10; n++) { await c.callback('role:creator'); await c.message('/start'); }
  assert.equal((await f.getTelegramContext({ telegramUserId: '2001' })).pendingInvite.status, 'valid');
  await c.callback('type:UGC');
  for (let n = 0; n < 10; n++) { await c.callback('type:AI'); await c.callback('role:creator'); }
  await c.callback(oldConfirmation);
  assert.match(c.sent.at(-1).text, /старое подтверждение/);
  const ctx = await f.getTelegramContext({ telegramUserId: '2001' });
  assert.equal(ctx.role, 'creator'); assert.equal(ctx.binding.type, 'UGC'); assert.equal(ctx.canSubmit, true);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM creators').get().n, 1);
});
test('interrupted type confirmation can resume without a new invitation', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const f = h.load('db/telegram-onboarding.ts');
  await f.selectTelegramRole({ telegramUserId: '1001', role: 'producer' });
  const invite = await f.createTelegramInvite({ telegramUserId: '1001', updateId: 1 });
  await f.acceptTelegramInvite({ telegramUserId: '2001', token: invite.token });
  h.sqlite.prepare("UPDATE telegram_accounts SET selected_type='AI' WHERE telegram_user_id='2001'").run();
  const c = conversation(h);
  await c.message('/start'); assert.equal(c.button('onboarding:'), 'onboarding:resume');
  await c.callback('onboarding:resume');
  assert.equal((await f.getTelegramContext({ telegramUserId: '2001' })).canSubmit, true);
});
test('bot link edit, pause/resume, deletion cancellation and stale confirmations', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const { context } = await onboard(h);
  const s = h.load('db/storage.ts');
  let id = await s.createChannel({ creatorId: context.binding.id, url: 'https://youtube.com/@before' });
  const c = conversation(h);
  await c.message('/channels');
  await c.callback(`channel:pause:${id}`);
  assert.equal(h.sqlite.prepare('SELECT status FROM creator_channels WHERE id=?').get(id).status, 'inactive');
  await c.callback(`channel:resume:${id}`);
  await c.callback(`channel:edit:${id}`);
  await c.message('https://youtube.com/@after');
  assert.match(c.sent.at(-1).text, /Ссылка изменена/);
  id = (await s.getDashboardData()).channels[0].id;
  await c.callback(`channel:delete:${id}`);
  const stale = c.button('channel:delete-confirm:');
  await c.callback('menu:channels');
  await c.callback(stale);
  assert.equal((await s.getDashboardData()).channels.length, 1);
  await c.callback(`channel:delete:${id}`);
  const current = c.button('channel:delete-confirm:');
  await c.callback(current); await c.callback(current);
  assert.equal((await s.getDashboardData()).channels.length, 0);
});
