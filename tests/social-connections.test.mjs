import test from 'node:test';
import assert from 'node:assert/strict';
import { storageHarness, onboard } from './storage-harness.mjs';

async function setup(t) {
  const h = storageHarness(); t.after(h.close);
  h.env.SOCIAL_VAULT_KEY = 'a'.repeat(64); h.env.CONTENT_PUBLIC_ORIGIN = 'https://fixture.example';
  const { context } = await onboard(h);
  const storage = h.load('db/storage.ts');
  const id = await storage.createChannel({ creatorId: context.binding.id, url: 'https://youtube.com/@alice' });
  const vault = h.load('db/social-connections.ts');
  const actor = { telegramUserId: '2001', id };
  const token = 'fixture-private-access-token';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ items: [{ id: 'UC1234567890123456789012', snippet: { customUrl: '@alice' } }] }));
  const ticket = await vault.createConnectTicket(actor);
  const ticketToken = ticket.url.split('/').at(-1);
  return { h, storage, vault, actor, token, ticketToken, id };
}

test('all TG accounts immediately visible, pending producer displayed, no invitation/token leak', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const flow = h.load('db/telegram-onboarding.ts'); const storage = h.load('db/storage.ts');
  await flow.getTelegramContext({ telegramUserId: '999', username: 'started' });
  let d = await storage.getDashboardData(); assert.equal(d.telegramAccounts.length, 1); assert.equal(d.creators.length, 0);
  await flow.selectTelegramRole({ telegramUserId: '1001', role: 'producer' });
  const invite = await flow.createTelegramInvite({ telegramUserId: '1001', updateId: 1 });
  await flow.acceptTelegramInvite({ telegramUserId: '999', token: invite.token });
  d = await storage.getDashboardData(); const a = d.telegramAccounts.find((a) => a.telegramUserId === '999');
  assert.ok(a.producerId); assert.match(a.stage, /ИИ/); assert.ok(!JSON.stringify(d).includes(invite.token));
  assert.ok(!JSON.stringify(d).includes('pendingInviteHash')); assert.equal(a.channelCount, 0);
  const rev = h.load('app/api/revision/route.ts').GET;
  const before = await (await rev()).text();
  await flow.selectTelegramCreatorType({ telegramUserId: '999', type: 'UGC' });
  assert.notEqual(await (await rev()).text(), before);
  d = await storage.getDashboardData(); assert.equal(d.creators.length, 1); assert.equal(d.channels.length, 0);
});

test('encrypted storage, single-use form, wrong owner/lease blocked, no token in dashboard', async (t) => {
  const { h, storage, vault, actor, token, ticketToken, id } = await setup(t);
  await onboard(h, { producerId: '1002', creatorId: '2002' });
  await assert.rejects(vault.createConnectTicket({ ...actor, telegramUserId: '2002' }), /не найден/);
  await vault.saveConnectTicket(ticketToken, { accessToken: token });
  await assert.rejects(vault.saveConnectTicket(ticketToken, { accessToken: token }), /использована/);
  const row = h.sqlite.prepare('SELECT * FROM social_connections').get();
  assert.ok(row.ciphertext.startsWith('v1.')); assert.ok(!row.ciphertext.includes(token));
  assert.ok(!JSON.stringify(await storage.getDashboardData()).includes(token));
  assert.ok(!JSON.stringify(await storage.getDashboardData()).includes('ciphertext'));
  const [claim] = await storage.claimDueChannels();
  await assert.rejects(vault.collectorConnection({ channelId: id, leaseToken: 'wrong' }), /сборщику/);
  const c = await vault.collectorConnection({ channelId: id, leaseToken: claim.leaseToken });
  assert.equal(c.credentials.accessToken, token);
  h.sqlite.prepare("UPDATE creators SET status='inactive' WHERE id=?").run(row.creator_id);
  await assert.rejects(vault.collectorConnection({ channelId: id, leaseToken: claim.leaseToken }), /сборщику/);
  h.sqlite.prepare("UPDATE creators SET status='active' WHERE id=?").run(row.creator_id);
  await vault.disconnectSocial(actor);
  await assert.rejects(vault.updateCollectorConnection({ channelId: id, leaseToken: claim.leaseToken, version: c.version, credentials: { accessToken: 'old-token-value' }, expiresAt: new Date(Date.now() + 10000).toISOString() }), /сборщику/);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM social_connections').get().n, 0);
});

test('expired/replaced tickets and archived channels cannot connect; deletion erases secrets', async (t) => {
  const { h, storage, vault, actor, token, ticketToken, id } = await setup(t);
  const newer = (await vault.createConnectTicket(actor)).url.split('/').at(-1);
  await assert.rejects(vault.connectTicket(ticketToken), /истекла/);
  await vault.saveConnectTicket(newer, { accessToken: token });
  const pending = (await vault.createConnectTicket(actor)).url.split('/').at(-1);
  await storage.deleteChannel({ id });
  await assert.rejects(vault.connectTicket(pending), /истекла/);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM social_connections').get().n, 0);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM social_connect_tickets').get().n, 0);
});

test('public form enforces origin, no cache, masked fields and no secret echo', async (t) => {
  const { h, token, ticketToken } = await setup(t);
  const route = h.load('app/connect/[token]/route.ts');
  const context = { params: Promise.resolve({ token: ticketToken }) };
  const get = await route.GET(new Request('https://fixture.example/connect/' + ticketToken), context);
  assert.equal(get.status, 200); assert.match(get.headers.get('cache-control'), /no-store/);
  assert.match(await get.text(), /type="password"/);
  const post = (origin) => route.POST(new Request('https://fixture.example/connect/' + ticketToken, { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ accessToken: token }) }), context);
  assert.equal((await post('https://evil.example')).status, 403);
  const success = await post('https://fixture.example'); assert.equal(success.status, 200);
  assert.ok(!(await success.text()).includes(token));
  assert.equal((await post('https://fixture.example')).status, 410);
});
