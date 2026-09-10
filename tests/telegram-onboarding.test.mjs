import test from 'node:test';
import assert from 'node:assert/strict';
import { storageHarness, onboard } from './storage-harness.mjs';

test('producer → invitation → mandatory creator type → contacts on own channels', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const f = h.load('db/telegram-onboarding.ts');
  assert.equal((await f.getTelegramContext({ telegramUserId: '1001' })).role, null);
  await f.selectTelegramRole({ telegramUserId: '1001', role: 'producer', username: 'producer' });
  const invite = await f.createTelegramInvite({ telegramUserId: '1001', updateId: 1 });
  const before = await f.acceptTelegramInvite({ telegramUserId: '2001', token: invite.token, username: 'creator' });
  assert.equal(before.canSubmit, false);
  await assert.rejects(f.requireTelegramCreatorReady('2001'), /выберите/);
  const ready = await f.selectTelegramCreatorType({ telegramUserId: '2001', type: 'AI' });
  assert.equal(ready.canSubmit, true);
  assert.equal(ready.binding.type, 'AI');
  assert.equal(ready.binding.producerTelegramId, '1001');
  const submit = h.load('db/telegram.ts').submitTelegramChannel;
  const result = await submit({ telegramUserId: '2001', updateId: 10, sourceUrl: 'https://youtube.com/@fixture', sourceKind: 'channel', channelUrl: 'https://youtube.com/@fixture' });
  assert.ok(result);
  const channels = await f.listTelegramChannels({ telegramUserId: '1001' });
  assert.equal(channels.length, 1);
  assert.equal(channels[0].creatorTelegramUsername, 'creator');
  assert.equal(channels[0].producerTelegramUsername, 'producer');
  assert.equal(channels[0].creatorType, 'AI');
});

test('type is selected once even with concurrent conflicting callbacks; survives role changes', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const f = h.load('db/telegram-onboarding.ts');
  await f.selectTelegramRole({ telegramUserId: '1001', role: 'producer' });
  const invitation = await f.createTelegramInvite({ telegramUserId: '1001', updateId: 1 });
  await f.acceptTelegramInvite({ telegramUserId: '2001', token: invitation.token });
  const results = await Promise.allSettled(['UGC', 'AI'].map((type) => f.selectTelegramCreatorType({ telegramUserId: '2001', type })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const context = await f.getTelegramContext({ telegramUserId: '2001' });
  await f.selectTelegramRole({ telegramUserId: '2001', role: 'producer' });
  await f.selectTelegramRole({ telegramUserId: '2001', role: 'creator' });
  assert.equal((await f.getTelegramContext({ telegramUserId: '2001' })).selectedType, context.selectedType);
  await assert.rejects(f.selectTelegramCreatorType({ telegramUserId: '2001', type: context.selectedType === 'AI' ? 'UGC' : 'AI' }), /уже выбран/);
});

test('invitations are private, idempotent, single-recipient and expiring', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const { flow: f, invite, context } = await onboard(h);
  assert.equal((await f.createTelegramInvite({ telegramUserId: '1001', updateId: 1 })).token, invite.token);
  assert.equal((await f.acceptTelegramInvite({ telegramUserId: '2001', token: invite.token })).binding.id, context.binding.id);
  await assert.rejects(f.acceptTelegramInvite({ telegramUserId: '2002', token: invite.token }), /использовано/);
  await f.selectTelegramRole({ telegramUserId: '1002', role: 'producer' });
  assert.equal((await f.getTelegramContext({ telegramUserId: '1002' })).creators.length, 0);
  await assert.rejects(f.createTelegramInvite({ telegramUserId: '1002', creatorId: context.binding.id, updateId: 2 }), /своего/);
  const other = await f.createTelegramInvite({ telegramUserId: '1002', updateId: 3 });
  await assert.rejects(f.acceptTelegramInvite({ telegramUserId: '2001', token: other.token }), /другому/);
  h.sqlite.exec("UPDATE telegram_invites SET expires_at = '2000-01-01T00:00:00.000Z' WHERE redeemed_by IS NULL");
  await assert.rejects(f.acceptTelegramInvite({ telegramUserId: '2002', token: other.token }), /истекло/);
});

test('simultaneous invitation redemption cannot bind two creators', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const f = h.load('db/telegram-onboarding.ts');
  await f.selectTelegramRole({ telegramUserId: '1001', role: 'producer' });
  const invite = await f.createTelegramInvite({ telegramUserId: '1001', updateId: 1 });
  for (const id of ['2001', '2002']) {
    await f.acceptTelegramInvite({ telegramUserId: id, token: invite.token });
  }
  const results = await Promise.allSettled(['2001', '2002'].map((id) => f.selectTelegramCreatorType({ telegramUserId: id, type: 'UGC' })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM telegram_creator_links').get().n, 1);
});

test('disabled owners cannot submit; malformed IDs and group chats rejected', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const { flow: f, context } = await onboard(h);
  for (const telegramUserId of ['', '0', '-1', '1.5', '9007199254740992']) {
    await assert.rejects(f.getTelegramContext({ telegramUserId }), /Telegram ID/);
  }
  await assert.rejects(f.getTelegramContext({ telegramUserId: '2001', chatId: '-2001' }), /личном/);
  h.sqlite.prepare("UPDATE producers SET status = 'inactive' WHERE id = ?").run(context.binding.producerId);
  assert.equal((await f.getTelegramContext({ telegramUserId: '2001' })).canSubmit, false);
  await assert.rejects(f.requireTelegramCreatorReady('2001'), /активного/);
});
