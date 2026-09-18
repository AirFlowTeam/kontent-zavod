import test from 'node:test';
import assert from 'node:assert/strict';
import { storageHarness, onboard } from './storage-harness.mjs';

function setup(t) {
  const h = storageHarness(); t.after(h.close);
  h.env.SOCIAL_VAULT_KEY = 'a'.repeat(64); h.env.CONTENT_PUBLIC_ORIGIN = 'https://fixture.example';
  return { h, flow: h.load('db/telegram-onboarding.ts'), submit: h.load('db/telegram.ts').submitTelegramChannel,
    vault: h.load('db/social-connections.ts'), journey: h.load('db/telegram-journey.ts') };
}
const total = (h, table) => h.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

test('both selected roles bootstrap only their own profile and can submit, connect personal API and queue collection', async (t) => {
  for (const role of ['creator', 'producer']) {
    const { h, flow, submit, vault, journey } = setup(t);
    const actor = { telegramUserId: '2001' };
    await flow.selectTelegramRole({ ...actor, role });
    const ready = await flow.selectTelegramCreatorType({ ...actor, type: 'UGC' });
    assert.equal(ready.role, role); assert.equal(ready.canSubmit, true);
    assert.equal(ready.canProduce, role === 'producer'); assert.equal(ready.dualRole, false);
    assert.equal(ready.binding.producerId, ready.producer.id);
    assert.equal(ready.binding.producerTelegramId, actor.telegramUserId);
    assert.equal(total(h, 'creators'), 1); assert.equal(total(h, 'producers'), 1);
    const channel = await submit({ ...actor, updateId: 40, sourceKind: 'channel', channelUrl: 'https://youtube.com/@my-personal' });
    assert.equal(channel.creatorId, ready.binding.id);
    assert.deepEqual((await flow.listTelegramChannels({ ...actor, scope: 'own' })).map(c => c.id), [channel.id]);
    const token = (await vault.createConnectTicket({ ...actor, id: channel.id })).url.split('/').at(-1);
    const ticket = await vault.connectTicket(token);
    h.sqlite.prepare('UPDATE social_connect_tickets SET consumed=1 WHERE token_hash=?').run(ticket.tokenHash);
    const saved = await vault.persistConnectedTicket(ticket.tokenHash, { accessToken: 'personal-fixture-token' }, { accountId: 'UC1234567890123456789012' }, null, null);
    assert.equal(saved.channelId, channel.id);
    const connection = h.sqlite.prepare('SELECT creator_id AS creatorId,channel_id AS channelId,account_id AS accountId,ciphertext FROM social_connections').get();
    assert.equal(connection.creatorId, ready.binding.id);
    assert.ok(!connection.ciphertext.includes('personal-fixture-token'));
    assert.equal((await vault.decrypt(connection)).accessToken, 'personal-fixture-token');
    assert.equal((await journey.recheckTelegramChannel({ ...actor, id: channel.id })).queued, true);
    await journey.setTelegramJourneyPlatform({ ...actor, platformName: 'VK', status: 'skipped' });
    assert.deepEqual((await journey.getTelegramJourney(actor)).journey.skippedPlatforms, ['VK']);
    if (role === 'creator') {
      await assert.rejects(flow.createTelegramInvite({ ...actor, updateId: 41 }), /продюсер/);
      await assert.rejects(flow.listTelegramChannels({ ...actor, scope: 'team' }), /Команда недоступна/);
    } else assert.ok((await flow.createTelegramInvite({ ...actor, updateId: 41 })).token);
    await assert.rejects(h.load('db/telegram-admin.ts').telegramAdminAction({ ...actor, action: 'adminRead' }), /администратору/);
    assert.equal(h.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
  }
});

test('a producer with an existing creator in another team keeps that team, type and API ownership', async (t) => {
  const { h, flow, submit, vault, journey } = setup(t);
  const { context: original } = await onboard(h, { creatorId: '2001', type: 'AI' });
  const actor = { telegramUserId: '2001' };
  await flow.selectTelegramRole({ ...actor, role: 'producer' });
  const ready = await flow.selectTelegramCreatorType({ ...actor, type: 'AI' });
  assert.equal(ready.role, 'producer'); assert.equal(ready.canProduce, true); assert.equal(ready.canSubmit, true);
  assert.equal(ready.binding.id, original.binding.id); assert.equal(ready.binding.producerId, original.binding.producerId);
  assert.notEqual(ready.producer.id, ready.binding.producerId);
  await assert.rejects(flow.selectTelegramCreatorType({ ...actor, type: 'UGC' }), /уже выбран/);
  const invite = await flow.createTelegramInvite({ ...actor, updateId: 50 });
  await flow.acceptTelegramInvite({ telegramUserId: '2002', token: invite.token });
  await flow.selectTelegramCreatorType({ telegramUserId: '2002', type: 'UGC' });
  const own = await submit({ ...actor, updateId: 51, sourceKind: 'channel', channelUrl: 'https://youtube.com/@own' });
  const team = await submit({ telegramUserId: '2002', updateId: 52, sourceKind: 'channel', channelUrl: 'https://youtube.com/@teammate' });
  assert.deepEqual((await flow.listTelegramChannels(actor)).map(c => c.id), [own.id]);
  assert.deepEqual((await flow.listTelegramChannels({ ...actor, scope: 'team' })).map(c => c.id), [team.id]);
  for (const action of [() => vault.createConnectTicket({ ...actor, id: team.id }), () => journey.recheckTelegramChannel({ ...actor, id: team.id }), () => flow.manageTelegramChannel({ ...actor, action: 'updateChannel', id: team.id, status: 'inactive' })]) {
    await assert.rejects(action(), /не найден/);
  }
  await assert.rejects(flow.selectTelegramCreatorType({ ...actor, type: 'AI', creatorId: team.creatorId }), /чужой профиль/);
  await assert.rejects(flow.selectTelegramCreatorType({ ...actor, type: 'AI', producerId: original.binding.producerId }), /чужой профиль/);
});

test('replayed and concurrent standalone type choices do not duplicate profiles or change the selected type', async (t) => {
  for (const role of ['creator', 'producer']) {
    const { h, flow } = setup(t); const actor = { telegramUserId: '2001' };
    await flow.selectTelegramRole({ ...actor, role });
    const results = await Promise.allSettled(['AI', 'UGC'].map(type => flow.selectTelegramCreatorType({ ...actor, type })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const ready = await flow.getTelegramContext(actor);
    await Promise.all([1, 2].map(() => flow.selectTelegramCreatorType({ ...actor, type: ready.selectedType })));
    assert.equal(total(h, 'creators'), 1); assert.equal(total(h, 'producers'), 1);
    assert.equal(total(h, 'telegram_creator_links'), 1); assert.equal(total(h, 'telegram_producer_links'), 1);
    assert.equal((await flow.getTelegramContext(actor)).binding.type, ready.selectedType);
  }
});

test('pending invitations win over standalone bootstrap and expired invitations do not silently create a different team', async (t) => {
  const { h, flow } = setup(t);
  const producer = await flow.selectTelegramRole({ telegramUserId: '1001', role: 'producer' });
  const invite = await flow.createTelegramInvite({ telegramUserId: '1001', updateId: 70 });
  await flow.acceptTelegramInvite({ telegramUserId: '2001', token: invite.token });
  const ready = await flow.selectTelegramCreatorType({ telegramUserId: '2001', type: 'UGC' });
  assert.equal(ready.binding.producerId, producer.producer.id); assert.equal(ready.producer, null);
  assert.equal(total(h, 'producers'), 1);
  const expired = await flow.createTelegramInvite({ telegramUserId: '1001', updateId: 71 });
  await flow.acceptTelegramInvite({ telegramUserId: '2002', token: expired.token });
  h.sqlite.prepare("UPDATE telegram_invites SET expires_at='2000-01-01' WHERE redeemed_by IS NULL").run();
  await assert.rejects(flow.selectTelegramCreatorType({ telegramUserId: '2002', type: 'AI' }), /истекло/);
  assert.equal(total(h, 'producers'), 1); assert.equal(total(h, 'creators'), 1);
});

test('an invitation arriving before the personal bootstrap transaction preserves the invited producer and creates no orphan team', async (t) => {
  const { h, flow } = setup(t);
  const producer = await flow.selectTelegramRole({ telegramUserId: '1001', role: 'producer' });
  const invite = await flow.createTelegramInvite({ telegramUserId: '1001', updateId: 80 });
  const actor = { telegramUserId: '2001' }; await flow.selectTelegramRole({ ...actor, role: 'creator' });
  const batch = h.DB.batch.bind(h.DB); let injected = false;
  h.DB.batch = async (items) => {
    if (!injected) { injected = true; await flow.acceptTelegramInvite({ ...actor, token: invite.token }); }
    return batch(items);
  };
  const ready = await flow.selectTelegramCreatorType({ ...actor, type: 'UGC' });
  assert.equal(ready.binding.producerId, producer.producer.id); assert.equal(ready.producer, null);
  assert.equal(total(h, 'producers'), 1); assert.equal(total(h, 'creators'), 1);
  assert.equal(h.sqlite.prepare('SELECT redeemed_by FROM telegram_invites').get().redeemed_by, actor.telegramUserId);
});

test('personal bootstrap winning during invite acceptance prevents stale invitation reparenting or pending-invite poisoning', async (t) => {
  const { h, flow } = setup(t);
  await flow.selectTelegramRole({ telegramUserId: '1001', role: 'producer' });
  const invite = await flow.createTelegramInvite({ telegramUserId: '1001', updateId: 90 });
  const actor = { telegramUserId: '2001' }; await flow.selectTelegramRole({ ...actor, role: 'creator' });
  const prepare = h.DB.prepare; let injected = false;
  h.DB.prepare = (sql) => {
    const statement = prepare(sql);
    if (sql.includes("SET role = 'creator', pending_invite_hash = ?")) {
      const bind = statement.bind;
      statement.bind = (...values) => {
        const bound = bind(...values); const run = bound.run.bind(bound);
        bound.run = async () => {
          if (!injected) { injected = true; await flow.selectTelegramCreatorType({ ...actor, type: 'AI' }); }
          return run();
        };
        return bound;
      };
    }
    return statement;
  };
  await assert.rejects(flow.acceptTelegramInvite({ ...actor, token: invite.token }), /другому креатору/);
  const ready = await flow.getTelegramContext(actor);
  assert.equal(ready.canSubmit, true); assert.equal(ready.binding.producerId, ready.producer.id);
  assert.equal(ready.pendingInvite, null); assert.equal(ready.binding.type, 'AI');
  assert.equal(h.sqlite.prepare('SELECT redeemed_by FROM telegram_invites').get().redeemed_by, null);
  assert.equal(total(h, 'creators'), 1); assert.equal(total(h, 'producers'), 2);
});

test('disabled producer and role invalidated before bootstrap cannot create a new personal profile', async (t) => {
  for (const mode of ['disabled', 'role-invalidated']) {
    const { h, flow } = setup(t); const actor = { telegramUserId: '2001' };
    await flow.selectTelegramRole({ ...actor, role: mode === 'disabled' ? 'producer' : 'creator' });
    if (mode === 'disabled') h.sqlite.prepare("UPDATE producers SET status='inactive'").run();
    else {
      const batch = h.DB.batch.bind(h.DB);
      h.DB.batch = async (items) => { h.sqlite.prepare('UPDATE telegram_accounts SET role=NULL').run(); return batch(items); };
    }
    await assert.rejects(flow.selectTelegramCreatorType({ ...actor, type: 'UGC' }), /Личный профиль не создан/);
    assert.equal(total(h, 'creators'), 0); assert.equal(total(h, 'telegram_creator_links'), 0);
    assert.equal(total(h, 'producers'), mode === 'disabled' ? 1 : 0);
  }
});
