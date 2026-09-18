import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

// Execute the production adapters with workerd's real fetch implementation.
// Only outbound HTTP is replaced: no credentials or network access are needed.
async function worker(t, outboundService) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const mf = new Miniflare({ compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    modulesRoot: root, modules: [
      { type: 'ESModule', path: `${root}runtime-test.mjs`, contents: `
        import { inspectAccess, verifyReadAccess, collectAuthorized, refreshAccess } from './lib/social-api.mjs';
        import { exchangeCode } from './lib/social-oauth.mjs';
        export default { async fetch(request) {
          try {
            if (new URL(request.url).pathname === '/youtube-oauth') {
              const env = { CONTENT_PUBLIC_ORIGIN: 'https://fixture.example', SOCIAL_VAULT_KEY: 'a'.repeat(64),
                YOUTUBE_CLIENT_ID: 'fixture-client', YOUTUBE_CLIENT_SECRET: 'fixture-secret', YOUTUBE_OAUTH_ENABLED: 'true' };
              const connection = await exchangeCode('youtube', env, { code: 'fixture-code' }, 'v'.repeat(64));
              const channel = { platformName: 'YouTube', url: 'https://youtube.com/@fixture' };
              const identity = await inspectAccess(channel, connection.credentials);
              const refreshed = await refreshAccess('YouTube', connection.credentials, { env, expectedAccountId: identity.accountId });
              const metrics = await collectAuthorized(channel, { ...connection, ...refreshed });
              return Response.json({ accountId: connection.accountId, metrics, authType: refreshed.credentials.authType });
            }
            if (new URL(request.url).pathname === '/oauth') {
              const result = await exchangeCode('threads', { CONTENT_PUBLIC_ORIGIN: 'https://fixture.example', SOCIAL_VAULT_KEY: 'a'.repeat(64),
                THREADS_CLIENT_ID: 'fixture-client', THREADS_CLIENT_SECRET: 'fixture-secret', THREADS_OAUTH_ENABLED: 'true' },
                { code: 'fixture-code' }, 'fixture-verifier');
              return Response.json({ accountId: result.accountId });
            }
            const channel = { platformName: 'YouTube', url: 'https://youtube.com/@fixture' };
            const credentials = { accessToken: 'fixture-personal-key' };
            const identity = await inspectAccess(channel, credentials);
            await verifyReadAccess(channel, credentials);
            const metrics = await collectAuthorized(channel, { accountId: identity.accountId, credentials });
            return Response.json({ accountId: identity.accountId, metrics });
          } catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
        } }` },
      ...await Promise.all(['social-api.mjs', 'social-oauth.mjs'].map(async (name) => ({ type: 'ESModule', path: `${root}lib/${name}`, contents: await readFile(new URL(`../lib/${name}`, import.meta.url), 'utf8') }))),
    ], outboundService,
  });
  t.after(() => mf.dispose());
  return mf;
}

await test('real Worker runtime validates personal YouTube credentials and collects an empty public channel', async (t) => {
  let requests = 0;
  const mf = await worker(t, (request) => {
    requests++;
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://www.googleapis.com');
    assert.equal(url.pathname, '/youtube/v3/channels');
    assert.equal(url.searchParams.get('key'), 'fixture-personal-key');
    return Response.json({ items: [{ id: 'UC1234567890123456789012', snippet: { title: 'Fixture', customUrl: '@fixture' },
      statistics: { videoCount: '0', viewCount: '0', subscriberCount: '0' }, contentDetails: {} }] });
  });
  const result = await mf.dispatchFetch('http://fixture.test/api');
  const body = await result.json();
  assert.equal(result.status, 200, body.error);
  assert.equal(body.metrics.totalViews, 0); assert.equal(body.metrics.publicationCount, 0); assert.equal(body.metrics.totalLikes, 0);
  assert.equal(requests, 3);
});

await test('real Worker runtime exchanges and refreshes Google OAuth using server POST secrets and header-only bearer access', async (t) => {
  let tokens = 0, apiRequests = 0;
  const mf = await worker(t, async (request) => {
    const url = new URL(request.url);
    assert.equal(url.searchParams.has('key'), false);
    if (url.origin === 'https://oauth2.googleapis.com') {
      tokens++;
      assert.equal(url.pathname, '/token'); assert.equal(request.method, 'POST');
      const form = new URLSearchParams(await request.text());
      assert.equal(form.get('client_secret'), 'fixture-secret');
      assert.equal(form.get('grant_type'), tokens === 1 ? 'authorization_code' : 'refresh_token');
      if (tokens === 1) assert.equal(form.get('code_verifier'), 'v'.repeat(64));
      return Response.json({ access_token: `fixture-access-${tokens}`, ...(tokens === 1 ? { refresh_token: 'fixture-refresh-token' } : {}),
        token_type: 'Bearer', expires_in: 3600, scope: 'https://www.googleapis.com/auth/youtube.readonly' });
    }
    apiRequests++;
    assert.equal(url.origin, 'https://www.googleapis.com');
    assert.equal(request.headers.get('Authorization'), `Bearer fixture-access-${tokens}`);
    assert.equal(url.pathname, '/youtube/v3/channels');
    return Response.json({ items: [{ id: 'UC1234567890123456789012', snippet: { customUrl: '@fixture' }, statistics: { videoCount: '0', viewCount: '0' } }] });
  });
  const response = await mf.dispatchFetch('http://fixture.test/youtube-oauth');
  const result = await response.json();
  assert.equal(response.status, 200, result.error);
  assert.equal(result.accountId, 'UC1234567890123456789012'); assert.equal(result.authType, 'youtube_oauth');
  assert.equal(result.metrics.totalLikes, 0); assert.equal(result.metrics.totalViews, 0);
  assert.equal(tokens, 2); assert.equal(apiRequests, 6);
});

await test('real Worker runtime completes token exchange without following credential-bearing redirects', async (t) => {
  let requests = 0;
  const mf = await worker(t, (request) => {
    requests++;
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://graph.threads.com');
    return Response.json(url.pathname === '/v1.0/me' ? { id: '123456789', username: 'fixture' }
      : { access_token: 'fixture-access-token', expires_in: 3600 });
  });
  const result = await mf.dispatchFetch('http://fixture.test/oauth');
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  assert.deepEqual(await result.json(), { accountId: '123456789' });
  assert.equal(requests, 3);
});

await test('both Worker adapters reject redirects before reading plausible success data or contacting another origin', async (t) => {
  const seen = [];
  const mf = await worker(t, (request) => {
    seen.push(new URL(request.url).origin);
    return Response.json({ items: [{ id: 'UC1234567890123456789012' }], access_token: 'redirect-token-must-not-be-used' },
      { status: 307, headers: { Location: 'https://untrusted.invalid/receive?secret=must-not-be-followed' } });
  });
  for (const path of ['/api', '/oauth', '/youtube-oauth']) {
    const result = await mf.dispatchFetch(`http://fixture.test${path}`);
    assert.equal(result.status, 400);
    const text = await result.text();
    assert.doesNotMatch(text, /untrusted|must-not-be|redirect-token/);
  }
  assert.deepEqual(seen, ['https://www.googleapis.com', 'https://graph.threads.com', 'https://oauth2.googleapis.com']);
});
