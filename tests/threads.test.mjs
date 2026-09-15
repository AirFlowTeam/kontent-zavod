import test from 'node:test';
import assert from 'node:assert/strict';
import { storageHarness, onboard } from './storage-harness.mjs';
import { inspectSubmittedUrl, directChannelDescriptor } from '../scripts/telegram-bot-lib.mjs';
import { authorizationUrl, exchangeCode, integrationStatus } from '../lib/social-oauth.mjs';
import { collectAuthorized, inspectAccess, refreshAccess, verifyReadAccess } from '../lib/social-api.mjs';

const accountId = '3141626745798170955'; // Must stay a string; exceeds JS exact integers.
const channel = { platformName: 'Threads', url: 'https://threads.com/@alice' };
const credentials = { accessToken: 'fixture-threads-long-token' };
const config = { CONTENT_PUBLIC_ORIGIN: 'https://fixture.example', SOCIAL_VAULT_KEY: 'a'.repeat(64), THREADS_CLIENT_ID: '123', THREADS_CLIENT_SECRET: 'fixture-secret', THREADS_OAUTH_ENABLED: 'true' };
function fixture({ missing = false, wrong = false, loop = false, denied = false, empty = false } = {}) {
  return async (url, init = {}) => {
    const u = new URL(url); assert.equal(u.origin, 'https://graph.threads.com');
    assert.equal(init.redirect, 'error');
    if (u.pathname === '/oauth/access_token') {
      assert.equal(init.body.get('client_id'), '123');
      assert.equal(init.body.get('redirect_uri'), 'https://fixture.example/connect/oauth/threads/callback');
      return Response.json({ access_token: 'fixture-short-threads', user_id: Number(accountId) });
    }
    if (u.pathname === '/access_token' || u.pathname === '/refresh_access_token') {
      assert.match(u.searchParams.get('grant_type'), /^th_(exchange|refresh)_token$/);
      return Response.json({ access_token: credentials.accessToken, expires_in: 5184000 });
    }
    assert.ok(init.headers.Authorization.startsWith('Bearer '));
    if (u.pathname === '/v1.0/me') return Response.json({ id: accountId, username: wrong ? 'other' : 'alice', name: 'Alice' });
    if (u.pathname === '/v1.0/me/threads_insights') {
      assert.equal(u.searchParams.get('metric'), 'followers_count'); // Never profile views.
      return denied ? Response.json({ error: { code: 190 } }, { status: 400 }) : Response.json({ data: [{ name: 'followers_count', total_value: { value: 4 } }] });
    }
    if (u.pathname === '/v1.0/me/threads') {
      if (empty) return Response.json({ data: [] });
      const post = (id, media_type = 'TEXT_POST') => ({ id, media_type, owner: { id: accountId }, username: 'alice' });
      if (u.searchParams.has('after')) return Response.json({ data: [post('2', 'CAROUSEL_ALBUM'), post('3', 'REPOST_FACADE')], ...(loop ? { paging: { next: 'https://untrusted.example/ignored', cursors: { after: 'cursor' } } } : {}) });
      return Response.json({ data: [post('1'), post('2', 'CAROUSEL_ALBUM')], paging: { next: 'https://untrusted.example/ignored', cursors: { after: 'cursor' } } });
    }
    if (/\/v1.0\/[12]\/insights/.test(u.pathname)) return Response.json({ data: [
      { name: 'views', period: 'lifetime', values: [{ value: 100 }] },
      ...(!missing ? [{ name: 'likes', period: 'lifetime', values: [{ value: 7 }] }] : []),
    ] });
    throw new Error('Unexpected Threads fixture endpoint');
  };
}

test('Threads aliases, encoded handle and post → profile; unsafe and ambiguous paths rejected', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const normalize = h.load('db/storage.ts').normalizeChannelUrl;
  for (const url of ['https://threads.net/@Alice?xmt=1', 'https://www.threads.com/%40alice', 'https://threads.net/@alice/post/Code_-1']) {
    const result = inspectSubmittedUrl(url);
    assert.equal(result.needsResolution, false); assert.equal(result.candidates[0], channel.url);
    assert.equal(directChannelDescriptor(result.candidates[0]).handle, '@alice');
    assert.equal(normalize(result.candidates[0]).platformName, 'Threads');
  }
  for (const url of ['https://threads.com.evil/@alice', 'https://threads.com/@alice/post/x/extra', 'https://threads.com/@a%2Fb', 'https://secret@threads.com/@alice', 'https://threads.com/login']) assert.equal(inspectSubmittedUrl(url).supported, false);
  assert.equal(normalize('https://threads.net/@ALICE').normalizedUrl, channel.url);
  assert.throws(() => normalize('https://threads.com/@alice/post/abc'));
});

test('Threads code exchange uses separate app, exact string ID, long token and safe readiness DTO', async () => {
  const url = new URL(await authorizationUrl('threads', config, 'a'.repeat(64), 'b'.repeat(64)));
  assert.equal(url.origin, 'https://threads.com');
  assert.equal(url.searchParams.get('scope'), 'threads_basic,threads_manage_insights');
  assert.ok(!JSON.stringify(integrationStatus(config)).includes(config.THREADS_CLIENT_SECRET));
  const result = await exchangeCode('threads', config, { code: 'fixture-code' }, '', { fetchImpl: fixture() });
  assert.equal(result.accountId, accountId);
  assert.equal(result.credentials.accessToken, credentials.accessToken);
  assert.ok(Date.parse(result.expiresAt) > Date.now());
  await assert.rejects(authorizationUrl('threads', { ...config, THREADS_OAUTH_ENABLED: 'false' }, 'a'.repeat(64), ''), /не настроил/);
});

test('Threads totals deduplicate full pages, carousel is one post, repost excluded, no profile-view substitution', async () => {
  const data = await collectAuthorized(channel, { accountId, credentials }, { fetchImpl: fixture() });
  assert.equal(data.publicationCount, 2); assert.equal(data.totalViews, 200); assert.equal(data.totalLikes, 14); assert.equal(data.followers, 4);
  assert.equal(data.parserSource, 'threads-api-own-root-posts');
  const missing = await collectAuthorized(channel, { credentials }, { fetchImpl: fixture({ missing: true }) });
  assert.equal(missing.totalLikes, null); assert.equal(missing.totalViews, 200);
  const empty = await collectAuthorized(channel, { credentials }, { fetchImpl: fixture({ empty: true }) });
  assert.equal(empty.publicationCount, 0); assert.equal(empty.totalViews, 0);
  await assert.rejects(collectAuthorized(channel, { credentials }, { fetchImpl: fixture({ loop: true }) }), /страница/);
  await assert.rejects(inspectAccess(channel, credentials, { fetchImpl: fixture({ wrong: true }) }), /другому/);
  await assert.rejects(verifyReadAccess(channel, credentials, { fetchImpl: fixture({ denied: true, empty: true }) }), /доступ/);
  await assert.rejects(collectAuthorized(channel, { accountId: '999', credentials }, { fetchImpl: fixture() }), /изменился/);
  assert.ok((await refreshAccess('Threads', credentials, { fetchImpl: fixture() })).expiresAt);
});

test('creator-only Threads OAuth → vault → collector → dashboard, alias duplicate and role guard', async (t) => {
  const h = storageHarness(); t.after(h.close); Object.assign(h.env, config);
  const { flow } = await onboard(h);
  const submit = h.load('db/telegram.ts').submitTelegramChannel;
  const created = await submit({ telegramUserId: '2001', updateId: 77, channelUrl: channel.url, sourceKind: 'channel' });
  const duplicate = await submit({ telegramUserId: '2001', updateId: 78, channelUrl: 'https://threads.net/@alice', sourceKind: 'channel' });
  assert.equal(duplicate.id, created.id);
  const vault = h.load('db/social-connections.ts'), oauth = h.load('db/social-oauth.ts'), storage = h.load('db/storage.ts');
  await assert.rejects(vault.createConnectTicket({ telegramUserId: '1001', id: created.id }));
  t.mock.method(globalThis, 'fetch', fixture());
  const token = (await vault.createConnectTicket({ telegramUserId: '2001', id: created.id })).url.split('/').at(-1);
  const route = h.load('app/connect/[token]/route.ts');
  const page = await route.GET(new Request(`https://fixture.example/connect/${token}`), { params: Promise.resolve({ token }) });
  assert.match(await page.text(), /Войти через Threads/);
  assert.match(page.headers.get('content-security-policy'), /https:\/\/threads.com/);
  const start = await oauth.startOAuth(token);
  await oauth.finishOAuth('threads', { state: start.state, code: 'fixture-code' }, start.cookie.split(';')[0].split('=')[1]);
  assert.equal((await oauth.oauthResult(start.state, start.cookie.split(';')[0].split('=')[1])).status, 'complete');
  const [claim] = await storage.claimDueChannels();
  const connection = await vault.collectorConnection({ channelId: created.id, leaseToken: claim.leaseToken });
  assert.equal(connection.accountId, accountId);
  assert.equal((await collectAuthorized(channel, connection)).totalViews, 200);
  const dashboard = await storage.getDashboardData();
  assert.equal(dashboard.channels.find((c) => c.id === created.id).platformName, 'Threads');
  assert.ok(!JSON.stringify(dashboard).includes(credentials.accessToken));
  await flow.selectTelegramRole({ telegramUserId: '2001', role: 'producer' });
  await assert.rejects(vault.createConnectTicket({ telegramUserId: '2001', id: created.id }));
});
