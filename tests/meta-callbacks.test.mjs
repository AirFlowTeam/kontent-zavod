import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { storageHarness, onboard } from './storage-harness.mjs';
import { readSignedRequest, verifySignedRequest, metaSubjectHash } from '../lib/meta-signed-request.mjs';
import { metaConnectionIdentity } from '../lib/meta-connection-identity.mjs';

const seconds = () => Math.floor(Date.now() / 1000);
const sign = (payload, secret = 'ig-fixture-secret') => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${createHmac('sha256', secret).update(encoded).digest('base64url')}.${encoded}`;
};
const envelope = (more = {}, secret) => sign({ algorithm: 'HMAC-SHA256', user_id: '123456', issued_at: seconds(), ...more }, secret);
const request = (signed) => new Request('https://example.test/connect/meta/instagram/data-deletion', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ signed_request: signed }),
});
async function fixture(t) {
  const h = storageHarness(); t.after(h.close);
  const { context } = await onboard(h);
  Object.assign(h.env, { CONTENT_PUBLIC_ORIGIN: 'https://example.test', INSTAGRAM_CLIENT_ID: '111', INSTAGRAM_CLIENT_SECRET: 'ig-fixture-secret',
    THREADS_CLIENT_ID: '222', THREADS_CLIENT_SECRET: 'threads-fixture-secret', SOCIAL_VAULT_KEY: 'ab'.repeat(32) });
  const submit = h.load('db/telegram.ts').submitTelegramChannel;
  const ig = await submit({ telegramUserId: '2001', updateId: 10, sourceKind: 'channel', channelUrl: 'https://instagram.com/owner' });
  const threads = await submit({ telegramUserId: '2001', updateId: 11, sourceKind: 'channel', channelUrl: 'https://threads.com/@owner' });
  const youtube = await submit({ telegramUserId: '2001', updateId: 12, sourceKind: 'channel', channelUrl: 'https://youtube.com/@owner' });
  for (const [channel, provider, appId] of [[ig, 'instagram', '111'], [threads, 'threads', '222']]) {
    h.sqlite.prepare('INSERT INTO meta_account_links VALUES (?,?,?,?,?,?)').run(channel.id, context.binding.id, provider, appId, await metaSubjectHash(provider, appId, '123456'), seconds() - 10);
    h.sqlite.prepare("INSERT INTO social_connections(channel_id,creator_id,telegram_user_id,account_id,username,ciphertext,status,updated_at) VALUES(?,?,'2001','professional-id','owner','encrypted-fixture','connected',?)")
      .run(channel.id, context.binding.id, new Date().toISOString());
    h.sqlite.prepare("UPDATE creator_channels SET provider_channel_id='professional-id',total_views=10,total_likes=2,publication_count=1,lease_token='current-lease',lease_until=? WHERE id=?")
      .run(new Date(Date.now() + 120_000).toISOString(), channel.id);
    h.sqlite.prepare("INSERT INTO channel_sync_history(channel_id,status,observed_at,recorded_at,creator_type_snapshot,producer_id_snapshot,total_views) VALUES(?,'success','2026-09-17','2026-09-17','UGC',?,10)")
      .run(channel.id, context.binding.producerId);
    h.sqlite.prepare('INSERT INTO telegram_channel_rechecks VALUES (?,?)').run(channel.id, new Date().toISOString());
    const ticketHash = String(channel.id).padStart(64, '0');
    const expires = new Date(Date.now() + 600_000).toISOString();
    h.sqlite.prepare("INSERT INTO social_connect_tickets VALUES(?,?,?,'2001',?,1)").run(ticketHash, channel.id, context.binding.id, expires);
    h.sqlite.prepare("INSERT INTO social_oauth_sessions VALUES(?,?,'browser',?,'session','exchanging',NULL,?)").run(ticketHash, ticketHash, provider, expires);
  }
  return { ...h, ig, threads, youtube, context, callbacks: h.load('db/meta-callbacks.ts') };
}

test('signed request requires signature on encoded payload, algorithm, exact string ID, timestamp, bounded form', async () => {
  const valid = envelope();
  assert.equal((await verifySignedRequest(valid, 'ig-fixture-secret')).subjectId, '123456');
  await assert.rejects(verifySignedRequest(valid, 'wrong'), (e) => e.status === 403);
  for (const changes of [{ algorithm: 'none' }, { user_id: 123456 }, { user_id: '0' }, { issued_at: undefined }, { issued_at: seconds() + 301 }, { expires: -1 }]) {
    await assert.rejects(verifySignedRequest(envelope(changes), 'ig-fixture-secret'));
  }
  for (const value of ['', '.', valid + '.extra', 'a'.repeat(16_385)]) await assert.rejects(verifySignedRequest(value, 'ig-fixture-secret'));
  assert.equal(await readSignedRequest(request(valid)), valid);
  await assert.rejects(readSignedRequest(new Request('https://example.test', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `signed_request=${valid}&signed_request=${valid}` })));
  await assert.rejects(readSignedRequest(new Request('https://example.test', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'x'.repeat(25_000) })), (e) => e.status === 413);
  const [sig, payload] = valid.split('.');
  assert.equal((await verifySignedRequest(`${sig}=.${payload}`, 'ig-fixture-secret')).canonicalEnvelope, valid);
});

test('deletion is atomic, removes only verified provider channel and returns repeatable receipt after completion', async (t) => {
  const h = await fixture(t);
  const beforeCreators = h.sqlite.prepare('SELECT count(*) n FROM creators').get().n;
  const beforeVideos = h.sqlite.prepare('SELECT count(*) n FROM videos').get().n;
  const signed = envelope();
  const first = await h.callbacks.metaCallback(request(signed), 'instagram', 'data-deletion');
  const second = await h.callbacks.metaCallback(request(signed), 'instagram', 'data-deletion');
  assert.deepEqual(second, first);
  assert.match(first.confirmation_code, /^[a-f0-9]{64}$/);
  assert.equal(first.url, `https://example.test/connect/meta/deletion/${first.confirmation_code}`);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM creator_channels WHERE id=?').get(h.ig.id).n, 0);
  for (const table of ['social_connections', 'social_connect_tickets', 'channel_sync_history', 'telegram_submissions', 'telegram_channel_rechecks', 'meta_account_links']) {
    assert.equal(h.sqlite.prepare(`SELECT count(*) n FROM ${table} WHERE channel_id=?`).get(h.ig.id).n, 0, table);
  }
  for (const id of [h.threads.id, h.youtube.id]) assert.equal(h.sqlite.prepare('SELECT status FROM creator_channels WHERE id=?').get(id).status, 'active');
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM creators').get().n, beforeCreators);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM videos').get().n, beforeVideos);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM social_oauth_sessions').get().n, 1);
  const receipt = await h.callbacks.metaDeletionStatus(first.confirmation_code);
  assert.equal(receipt.status, 'operational_deleted'); assert.equal(receipt.affectedChannels, 1);
  assert.equal(h.sqlite.prepare('SELECT target_ids FROM meta_callback_receipts').get().target_ids, null);
  assert.equal(await h.callbacks.metaDeletionStatus('invalid'), null);
});

test('deauthorization pauses and removes access while retaining a verified identity for a later deletion', async (t) => {
  const h = await fixture(t);
  const result = await h.callbacks.metaCallback(request(envelope()), 'instagram', 'deauthorize');
  assert.equal(result.success, true);
  const row = h.sqlite.prepare('SELECT status,total_views,lease_token FROM creator_channels WHERE id=?').get(h.ig.id);
  assert.equal(row.status, 'inactive'); assert.equal(row.total_views, 10); assert.equal(row.lease_token, null);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM social_connections WHERE channel_id=?').get(h.ig.id).n, 0);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM meta_account_links WHERE channel_id=?').get(h.ig.id).n, 1);
  const result2 = await h.callbacks.metaCallback(request(envelope()), 'instagram', 'data-deletion');
  assert.equal((await h.callbacks.metaDeletionStatus(result2.confirmation_code)).status, 'operational_deleted');
});

test('wrong product secret, unknown subject and delayed pre-reconnect event cannot delete other data', async (t) => {
  const h = await fixture(t);
  const invalid = await h.callbacks.metaCallbackResponse(request(envelope()), 'threads', 'data-deletion');
  assert.equal(invalid.status, 403);
  assert.equal((await invalid.text()).includes('123456'), false);
  const absent = await h.callbacks.metaCallback(request(envelope({ user_id: '999999' })), 'instagram', 'data-deletion');
  assert.equal((await h.callbacks.metaDeletionStatus(absent.confirmation_code)).status, 'no_matching_data');
  h.sqlite.prepare('UPDATE meta_account_links SET authorized_at=? WHERE channel_id=?').run(seconds() + 1, h.ig.id);
  const late = await h.callbacks.metaCallback(request(envelope()), 'instagram', 'data-deletion');
  assert.equal((await h.callbacks.metaDeletionStatus(late.confirmation_code)).status, 'newer_connection_preserved');
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM creator_channels').get().n, 3);
});

test('same-second callback never deletes a fresh connection and the status explains timestamp ambiguity', async (t) => {
  const h = await fixture(t);
  const now = seconds();
  h.sqlite.prepare('UPDATE meta_account_links SET authorized_at=? WHERE channel_id=?').run(now, h.ig.id);
  const result = await h.callbacks.metaCallback(request(envelope({ issued_at: now })), 'instagram', 'data-deletion');
  assert.equal((await h.callbacks.metaDeletionStatus(result.confirmation_code)).status, 'newer_connection_preserved');
  assert.equal(h.sqlite.prepare('SELECT status FROM creator_channels WHERE id=?').get(h.ig.id).status, 'active');
  const response = await h.load('app/connect/meta/deletion/[code]/route.ts').GET(new Request(result.url), { params: Promise.resolve({ code: result.confirmation_code }) });
  assert.match(await response.text(), /точностью до секунды/);
});

test('a failing dependent delete rolls back tokens, channels and receipt; concurrent replay has one result', async (t) => {
  const h = await fixture(t);
  h.sqlite.exec("CREATE TRIGGER block_meta_delete BEFORE DELETE ON creator_channels BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  const result = await h.callbacks.metaCallbackResponse(request(envelope()), 'instagram', 'data-deletion');
  assert.equal(result.status, 503);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM meta_callback_receipts').get().n, 0);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM social_connections').get().n, 2);
  assert.equal(h.sqlite.prepare('SELECT status FROM creator_channels WHERE id=?').get(h.ig.id).status, 'active');
  h.sqlite.exec('DROP TRIGGER block_meta_delete');
  const signed = envelope();
  const [one, two] = await Promise.all([h.callbacks.metaCallback(request(signed), 'instagram', 'data-deletion'), h.callbacks.metaCallback(request(signed), 'instagram', 'data-deletion')]);
  assert.deepEqual(one, two);
});

test('only our OAuth app-scoped subject is mapped; manually provided token is not attributed to our app', async (t) => {
  const h = await fixture(t);
  const identity = { accountId: '17841400000000000', profile: { id: '123456' } };
  assert.equal(await metaConnectionIdentity('Instagram', identity, h.env, undefined), null);
  assert.equal((await metaConnectionIdentity('Instagram', identity, h.env, 'oauth')).subjectHash, await metaSubjectHash('instagram', '111', '123456'));
  await assert.rejects(metaConnectionIdentity('Instagram', { accountId: '123456' }, h.env, 'oauth'));
  h.sqlite.prepare('DELETE FROM meta_account_links WHERE channel_id=?').run(h.ig.id);
  h.sqlite.prepare('DELETE FROM social_connections WHERE channel_id=?').run(h.ig.id);
  const vault = h.load('db/social-connections.ts');
  const created = await vault.createConnectTicket({ telegramUserId: '2001', id: h.ig.id });
  const token = created.url.split('/').at(-1);
  const ticket = await vault.connectTicket(token);
  const stateHash = 'cd'.repeat(32);
  h.sqlite.prepare('UPDATE social_connect_tickets SET consumed=1 WHERE token_hash=?').run(ticket.tokenHash);
  h.sqlite.prepare("INSERT INTO social_oauth_sessions(state_hash,ticket_hash,browser_hash,provider,ciphertext,status,expires_at) VALUES(?,?,'browser','instagram','session','exchanging',?)")
    .run(stateHash, ticket.tokenHash, ticket.expiresAt);
  await vault.persistConnectedTicket(ticket.tokenHash, { accessToken: 'fixture-token' }, identity, null, null, stateHash);
  const mapping = h.sqlite.prepare('SELECT * FROM meta_account_links WHERE channel_id=?').get(h.ig.id);
  assert.equal(mapping.subject_hash, await metaSubjectHash('instagram', '111', '123456'));
  assert.equal(h.sqlite.prepare('SELECT account_id FROM social_connections WHERE channel_id=?').get(h.ig.id).account_id, identity.accountId);
});

test('an in-flight authorization started before even an unknown-subject callback cannot revive data', async (t) => {
  const h = await fixture(t);
  h.sqlite.prepare('DELETE FROM meta_account_links WHERE channel_id=?').run(h.ig.id);
  h.sqlite.prepare('DELETE FROM social_connections WHERE channel_id=?').run(h.ig.id);
  const vault = h.load('db/social-connections.ts');
  const created = await vault.createConnectTicket({ telegramUserId: '2001', id: h.ig.id });
  const ticket = await vault.connectTicket(created.url.split('/').at(-1));
  const state = 'de'.repeat(32);
  h.sqlite.prepare('UPDATE social_connect_tickets SET consumed=1 WHERE token_hash=?').run(ticket.tokenHash);
  h.sqlite.prepare("INSERT INTO social_oauth_sessions(state_hash,ticket_hash,browser_hash,provider,ciphertext,status,expires_at) VALUES(?,?,'browser','instagram','session','exchanging',?)").run(state, ticket.tokenHash, ticket.expiresAt);
  await h.callbacks.metaCallback(request(envelope()), 'instagram', 'data-deletion');
  await assert.rejects(vault.persistConnectedTicket(ticket.tokenHash, { accessToken: 'fixture-token' }, { accountId: 'professional-id', profile: { id: '123456' } }, null, null, state), /изменены/);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM social_connections WHERE channel_id=?').get(h.ig.id).n, 0);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM meta_account_links WHERE channel_id=?').get(h.ig.id).n, 0);
  assert.equal(h.sqlite.prepare('SELECT status FROM social_oauth_sessions WHERE state_hash=?').get(state).status, 'exchanging');
});

test('reconnect after deauthorization preserves pause and explicitly instructs the user to resume collection', async (t) => {
  const h = await fixture(t);
  await h.callbacks.metaCallback(request(envelope({ issued_at: seconds() - 2 })), 'instagram', 'deauthorize');
  const vault = h.load('db/social-connections.ts');
  const created = await vault.createConnectTicket({ telegramUserId: '2001', id: h.ig.id });
  const ticket = await vault.connectTicket(created.url.split('/').at(-1));
  const state = 'ab'.repeat(32);
  h.sqlite.prepare('UPDATE social_connect_tickets SET consumed=1 WHERE token_hash=?').run(ticket.tokenHash);
  h.sqlite.prepare("INSERT INTO social_oauth_sessions(state_hash,ticket_hash,browser_hash,provider,ciphertext,status,expires_at) VALUES(?,?,'browser','instagram','session','exchanging',?)").run(state, ticket.tokenHash, ticket.expiresAt);
  await vault.persistConnectedTicket(ticket.tokenHash, { accessToken: 'new-fixture-token' }, { accountId: 'professional-id', profile: { id: '123456' } }, null, null, state);
  const oauthResult = h.sqlite.prepare('SELECT status,message FROM social_oauth_sessions WHERE state_hash=?').get(state);
  assert.equal(oauthResult.status, 'complete'); assert.match(oauthResult.message, /Возобновить сбор/);
  assert.equal(h.sqlite.prepare('SELECT status FROM creator_channels WHERE id=?').get(h.ig.id).status, 'inactive');
  const storage = h.load('db/storage.ts');
  await storage.updateChannel({ id: h.ig.id, status: 'active' }, h.context.binding.id);
  assert.ok((await storage.claimDueChannels(10)).some((channel) => channel.id === h.ig.id));
});

test('manual replacement removes prior automatic callback attribution without disabling manual access', async (t) => {
  const h = await fixture(t);
  const vault = h.load('db/social-connections.ts');
  const created = await vault.createConnectTicket({ telegramUserId: '2001', id: h.ig.id });
  const ticket = await vault.connectTicket(created.url.split('/').at(-1));
  h.sqlite.prepare('UPDATE social_connect_tickets SET consumed=1 WHERE token_hash=?').run(ticket.tokenHash);
  await vault.persistConnectedTicket(ticket.tokenHash, { accessToken: 'manual-other-app-token' }, { accountId: 'professional-id', profile: { id: 'different-app-scoped-subject' } }, null, null);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM meta_account_links WHERE channel_id=?').get(h.ig.id).n, 0);
  const result = await h.callbacks.metaCallback(request(envelope()), 'instagram', 'data-deletion');
  assert.equal((await h.callbacks.metaDeletionStatus(result.confirmation_code)).status, 'no_matching_data');
  assert.equal(h.sqlite.prepare('SELECT status FROM social_connections WHERE channel_id=?').get(h.ig.id).status, 'connected');
});
