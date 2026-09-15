import test from 'node:test';
import assert from 'node:assert/strict';
import { storageHarness, onboard } from './storage-harness.mjs';
import { authorizationUrl, callbackParams, exchangeCode, integrationStatus, pkceChallenge } from '../lib/social-oauth.mjs';
import { collectAuthorized, refreshAccess } from '../lib/social-api.mjs';

const scopes = ['instagram_business_basic', 'instagram_business_manage_insights'];
const config = { CONTENT_PUBLIC_ORIGIN: 'https://fixture.example', SOCIAL_VAULT_KEY: 'a'.repeat(64),
  INSTAGRAM_CLIENT_ID: '123', INSTAGRAM_CLIENT_SECRET: 'fixture-app-secret', INSTAGRAM_OAUTH_ENABLED: 'true',
  TIKTOK_CLIENT_KEY: 'fixture-client-key', TIKTOK_CLIENT_SECRET: 'fixture-tt-secret', TIKTOK_OAUTH_ENABLED: 'true',
  VK_CLIENT_ID: '456', VK_SERVICE_TOKEN: 'fixture-service-secret', VK_OAUTH_ENABLED: 'true' };
const json = (data, status = 200) => Response.json(data, { status });
function igFetch(username = 'alice') {
  return async (url, init) => {
    const u = new URL(url);
    assert.equal(init.redirect, 'error');
    if (u.hostname === 'api.instagram.com') {
      assert.ok(init.body instanceof FormData);
      assert.equal(init.body.get('client_id'), '123');
      return json({ data: [{ access_token: 'fixture-short-lived', user_id: '4242', permissions: scopes }] });
    }
    if (u.pathname === '/access_token') return json({ access_token: 'fixture-long-lived', expires_in: 5184000 });
    if (u.pathname.endsWith('/me')) return json({ user_id: '42', id: '4242', username, account_type: 'BUSINESS', followers_count: 10, media_count: 1 });
    if (u.pathname.endsWith('/media')) return json({ data: [{ id: '99', media_type: 'VIDEO', like_count: 7, owner: { id: '42' }, username }] });
    if (u.pathname.endsWith('/insights')) return json({ data: [{ name: 'views', period: 'lifetime', values: [{ value: 100 }] }] });
    throw new Error('Unexpected fixture endpoint');
  };
}
async function setup(t) {
  const h = storageHarness(); t.after(h.close); Object.assign(h.env, config);
  const { context } = await onboard(h);
  const storage = h.load('db/storage.ts'); const vault = h.load('db/social-connections.ts'); const oauth = h.load('db/social-oauth.ts');
  const id = await storage.createChannel({ creatorId: context.binding.id, url: 'https://instagram.com/alice/' });
  const actor = { telegramUserId: '2001', id };
  const token = (await vault.createConnectTicket(actor)).url.split('/').at(-1);
  t.mock.method(globalThis, 'fetch', igFetch());
  return { h, storage, vault, oauth, actor, token, id };
}
const secretOf = (start) => start.cookie.split(';')[0].split('=')[1];

test('OAuth exact redirect/config readiness and PKCE RFC7636 vector; no config secrets in DTO', async () => {
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const vk = new URL(await authorizationUrl('vk', config, 'a'.repeat(64), 'b'.repeat(64)));
  assert.equal(vk.origin, 'https://id.vk.ru'); assert.equal(vk.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(vk.searchParams.get('redirect_uri'), 'https://fixture.example/connect/oauth/vk/callback');
  assert.ok(!vk.toString().includes(config.VK_SERVICE_TOKEN));
  const tt = new URL(await authorizationUrl('tiktok', config, 'a'.repeat(64), 'b'.repeat(64)));
  assert.equal(tt.searchParams.get('client_key'), config.TIKTOK_CLIENT_KEY); assert.equal(tt.searchParams.has('code_challenge'), false);
  assert.ok(!JSON.stringify(integrationStatus(config)).includes('fixture-app-secret'));
  await assert.rejects(authorizationUrl('instagram', { ...config, INSTAGRAM_OAUTH_ENABLED: 'false' }, 'a'.repeat(64), ''), /не настроил/);
  assert.ok(!integrationStatus({ ...config, CONTENT_PUBLIC_ORIGIN: 'https://user:pass@fixture.example' })[0].ready);
});

test('VK payload supported, mixed/conflicting/repeated/state-less callback rejected', () => {
  const state = 'a'.repeat(64);
  const url = `https://fixture.example/cb?${new URLSearchParams({ payload: JSON.stringify({ type: 'code_v2', state, code: 'code', device_id: 'device' }) })}`;
  assert.equal(callbackParams('vk', url).device_id, 'device');
  assert.throws(() => callbackParams('vk', `${url}&code=other`), /Противоречивый/);
  assert.throws(() => callbackParams('vk', `${url}&state=${state}&state=${state}`), /Неоднозначный/);
  assert.throws(() => callbackParams('instagram', url), /Некорректный/);
  assert.throws(() => callbackParams('instagram', 'https://fixture.example/cb?code=abc'), /Состояние/);
});

test('IG exchange requires permissions, converts nested short token and validates long expiry', async () => {
  const result = await exchangeCode('instagram', config, { code: 'fixture-code', state: 'a'.repeat(64) }, '', { fetchImpl: igFetch() });
  assert.equal(result.credentials.accessToken, 'fixture-long-lived'); assert.equal(result.accountId, '4242');
  await assert.rejects(exchangeCode('instagram', config, { code: 'fixture-code' }, '', { fetchImpl: async () => json({ data: [{ access_token: 'secret-in-error', user_id: 42, permissions: ['instagram_business_basic'] }] }) }), (e) => /разрешения/.test(e.message) && !e.message.includes('secret-in-error'));
});

test('TT requires granted video.list and refresh; VK sends confidential service token and verifier', async () => {
  const args = { state: 'a'.repeat(64), code: 'fixture-code', device_id: 'fixture-device' };
  await assert.rejects(exchangeCode('tiktok', config, args, '', { fetchImpl: async () => json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', open_id: 'open1', expires_in: 86400, scope: 'user.info.basic,user.info.stats,user.info.profile' }) }), /разрешения/);
  const tt = await exchangeCode('tiktok', config, args, '', { fetchImpl: async () => json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', open_id: 'open1', expires_in: 86400, scope: 'user.info.basic,user.info.stats,user.info.profile,video.list' }) });
  assert.equal(tt.accountId, 'open1');
  const vk = await exchangeCode('vk', config, args, 'verifier', { fetchImpl: async (_url, init) => {
    assert.equal(init.body.get('service_token'), config.VK_SERVICE_TOKEN); assert.equal(init.body.get('code_verifier'), 'verifier');
    return json({ access_token: 'fixture-vk-access', refresh_token: 'fixture-vk-refresh', user_id: 42, expires_in: 3600, state: args.state });
  } });
  assert.equal(vk.credentials.clientId, config.VK_CLIENT_ID); assert.equal(vk.credentials.deviceId, args.device_id);
});

test('complete OAuth → encrypted save → claim → full API aggregate; repeat callback and result safe', async (t) => {
  const { h, storage, vault, oauth, token, id } = await setup(t);
  const start = await oauth.startOAuth(token); const secret = secretOf(start);
  assert.match(start.cookie, /HttpOnly; Secure; SameSite=Lax/);
  await oauth.finishOAuth('instagram', { state: start.state, code: 'fixture-code' }, secret);
  assert.equal((await oauth.oauthResult(start.state, secret)).status, 'complete');
  await oauth.finishOAuth('instagram', { state: start.state, code: 'already-used' }, secret);
  const [claim] = await storage.claimDueChannels(); const connection = await vault.collectorConnection({ channelId: id, leaseToken: claim.leaseToken });
  const metrics = await collectAuthorized({ platformName: 'Instagram', url: 'https://instagram.com/alice/' }, connection);
  assert.equal(metrics.totalViews, 100); assert.equal(metrics.totalLikes, 7); assert.equal(metrics.publicationCount, 1);
  assert.ok(!JSON.stringify(await storage.getDashboardData()).includes('fixture-long-lived'));
  assert.equal(h.sqlite.prepare('SELECT ciphertext FROM social_oauth_sessions').get().ciphertext, '');
});

test('wrong browser/provider/expired state cannot consume or attach a connection', async (t) => {
  const { h, oauth, token } = await setup(t); const start = await oauth.startOAuth(token);
  await assert.rejects(oauth.finishOAuth('instagram', { state: start.state, code: 'code' }, 'b'.repeat(64)), /истекла/);
  await assert.rejects(oauth.finishOAuth('tiktok', { state: start.state, code: 'code' }, secretOf(start)), /совпадает/);
  assert.equal(h.sqlite.prepare('SELECT status FROM social_oauth_sessions').get().status, 'pending');
  h.sqlite.prepare("UPDATE social_oauth_sessions SET expires_at='2000-01-01T00:00:00.000Z'").run();
  await assert.rejects(oauth.finishOAuth('instagram', { state: start.state, code: 'code' }, secretOf(start)), /истекла/);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM social_connections').get().n, 0);
});

test('cancel, new bot ticket and delete prevent later callback; duplicate Start preserves first attempt', async (t) => {
  const { h, oauth, vault, storage, actor, token, id } = await setup(t); const first = await oauth.startOAuth(token);
  await assert.rejects(oauth.startOAuth(token));
  await oauth.finishOAuth('instagram', { state: first.state, error: 'access_denied' }, secretOf(first));
  assert.equal((await oauth.oauthResult(first.state, secretOf(first))).status, 'cancelled');
  const nextToken = (await vault.createConnectTicket(actor)).url.split('/').at(-1); const next = await oauth.startOAuth(nextToken);
  await assert.rejects(oauth.finishOAuth('instagram', { state: first.state, code: 'code' }, secretOf(first)), /истекла/);
  await storage.deleteChannel({ id });
  await assert.rejects(oauth.finishOAuth('instagram', { state: next.state, code: 'code' }, secretOf(next)), /истекла/);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM social_oauth_sessions').get().n, 0);
});

test('wrong owner preserves previous connection; disabled platform during final batch cannot save', async (t) => {
  const { h, oauth, vault, actor, token } = await setup(t); const first = await oauth.startOAuth(token);
  await oauth.finishOAuth('instagram', { state: first.state, code: 'code' }, secretOf(first));
  const previous = h.sqlite.prepare('SELECT ciphertext FROM social_connections').get().ciphertext;
  t.mock.method(globalThis, 'fetch', igFetch('other'));
  const second = await oauth.startOAuth((await vault.createConnectTicket(actor)).url.split('/').at(-1));
  await oauth.finishOAuth('instagram', { state: second.state, code: 'code' }, secretOf(second));
  assert.equal((await oauth.oauthResult(second.state, secretOf(second))).status, 'error');
  assert.equal(h.sqlite.prepare('SELECT ciphertext FROM social_connections').get().ciphertext, previous);
  t.mock.method(globalThis, 'fetch', igFetch());
  const third = await oauth.startOAuth((await vault.createConnectTicket(actor)).url.split('/').at(-1));
  const batch = h.DB.batch.bind(h.DB); let calls = 0;
  h.DB.batch = async (items) => { calls++; h.sqlite.prepare("UPDATE platforms SET status='inactive' WHERE name='Instagram'").run(); return batch(items); };
  await oauth.finishOAuth('instagram', { state: third.state, code: 'code' }, secretOf(third));
  assert.equal(calls, 1); assert.equal(h.sqlite.prepare('SELECT ciphertext FROM social_connections').get().ciphertext, previous);
  assert.equal((await oauth.oauthResult(third.state, secretOf(third))).status, 'error');
});

test('GET does not consume ticket; cross-origin Start refused; callback redirects to clean cookie-bound result', async (t) => {
  const { h, token } = await setup(t); const route = h.load('app/connect/[token]/route.ts');
  const context = { params: Promise.resolve({ token }) }; const url = `https://fixture.example/connect/${token}`;
  assert.equal((await route.GET(new Request(url), context)).status, 200);
  assert.equal(h.sqlite.prepare('SELECT consumed FROM social_connect_tickets').get().consumed, 0);
  const post = (origin) => route.POST(new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: 'action=oauth' }), context);
  assert.equal((await post('https://evil.example')).status, 403);
  const start = await post('https://fixture.example'); assert.equal(start.status, 303);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const callback = h.load('app/connect/oauth/[provider]/callback/route.ts');
  const r = await callback.GET(new Request(`https://fixture.example/connect/oauth/instagram/callback?state=${state}&code=fixture-code`, { headers: { cookie: start.headers.get('set-cookie').split(';')[0] } }), { params: Promise.resolve({ provider: 'instagram' }) });
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), `/connect/result/${state}`); assert.match(r.headers.get('cache-control'), /no-store/);
});

test('manual invalid syntax is retryable; unrefreshable Instagram token never overwrites connection', async (t) => {
  const { h, vault, token } = await setup(t);
  await assert.rejects(vault.saveConnectTicket(token, { accessToken: 'bad' }), /Вставьте/);
  assert.equal(h.sqlite.prepare('SELECT consumed FROM social_connect_tickets').get().consumed, 0);
  const base = igFetch(); t.mock.method(globalThis, 'fetch', async (u, init) => new URL(u).pathname === '/refresh_access_token' ? json({ error: { code: 190, message: 'sensitive provider detail' } }, 400) : base(u, init));
  await assert.rejects(vault.saveConnectTicket(token, { accessToken: 'fixture-short-lived' }), /не подтвердил продление/);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM social_connections').get().n, 0);
});

test('commit rechecks session TTL/status and ticket TTL after encryption', async (t) => {
  for (const sql of ["UPDATE social_oauth_sessions SET expires_at='2000-01-01T00:00:00.000Z'", "UPDATE social_connect_tickets SET expires_at='2000-01-01T00:00:00.000Z'", "UPDATE social_oauth_sessions SET status='cancelled'"]) {
    const { h, oauth, token } = await setup(t); const start = await oauth.startOAuth(token);
    const batch = h.DB.batch.bind(h.DB);
    h.DB.batch = async (items) => { h.sqlite.exec(sql); return batch(items); };
    await oauth.finishOAuth('instagram', { state: start.state, code: 'code' }, secretOf(start));
    assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM social_connections').get().n, 0);
    assert.notEqual(h.sqlite.prepare('SELECT status FROM social_oauth_sessions').get().status, 'complete');
  }
});

test('channel deletion during token exchange never resurrects credentials', async (t) => {
  const { h, oauth, storage, token, id } = await setup(t); const start = await oauth.startOAuth(token);
  const base = igFetch();
  t.mock.method(globalThis, 'fetch', async (url, init) => { if (new URL(url).hostname === 'api.instagram.com') await storage.deleteChannel({ id }); return base(url, init); });
  await oauth.finishOAuth('instagram', { state: start.state, code: 'code' }, secretOf(start));
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM social_connections').get().n, 0);
});

test('refresh retry after lost ACK is idempotent; mismatched retry rejected', async (t) => {
  const { vault, oauth, storage, token, id } = await setup(t); const start = await oauth.startOAuth(token);
  await oauth.finishOAuth('instagram', { state: start.state, code: 'code' }, secretOf(start));
  const [claim] = await storage.claimDueChannels(); const c = await vault.collectorConnection({ channelId: id, leaseToken: claim.leaseToken });
  // Ensure version differs even on a fast fixture clock.
  const input = { channelId: id, leaseToken: claim.leaseToken, version: c.version, credentials: { accessToken: 'fixture-rotated-token' }, expiresAt: new Date(Date.now() + 5000000).toISOString() };
  const saved = await vault.updateCollectorConnection(input); const retry = await vault.updateCollectorConnection(input);
  assert.equal(saved.version, retry.version);
  await assert.rejects(vault.updateCollectorConnection({ ...input, version: 'stale', credentials: { accessToken: 'different-token' } }), /изменён/);
});

test('VK refresh sends confidential service token only for configured client', async () => {
  for (const clientId of ['456', '789']) {
    const r = await refreshAccess('VK', { accessToken: 'fixture-access', refreshToken: 'fixture-refresh', deviceId: 'fixture-device', clientId }, { expectedAccountId: '42', vkClientId: '456', vkServiceToken: 'fixture-service', fetchImpl: async (_url, init) => {
      assert.equal(init.body.get('service_token'), clientId === '456' ? 'fixture-service' : null);
      return json({ access_token: 'fixture-new-access', refresh_token: 'fixture-new-refresh', expires_in: 3600, user_id: 42, state: init.body.get('state') });
    } });
    assert.equal(r.credentials.refreshToken, 'fixture-new-refresh');
  }
});
