import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizationUrl, callbackParams, exchangeCode, integrationStatus, pkceChallenge } from '../lib/social-oauth.mjs';
import { collectAuthorized, inspectAccess, parseCredentials, refreshAccess, youtubeReadonlyScope } from '../lib/social-api.mjs';
import { collectYouTubeWithPersonalKey } from '../scripts/youtube-personal-api.mjs';

const id = 'UC1234567890123456789012';
const otherId = 'UC0000000000000000000000';
const env = { CONTENT_PUBLIC_ORIGIN: 'https://fixture.example', SOCIAL_VAULT_KEY: 'a'.repeat(64), YOUTUBE_CLIENT_ID: 'fixture-web-client', YOUTUBE_CLIENT_SECRET: 'fixture-server-secret', YOUTUBE_OAUTH_ENABLED: 'true' };
const credentials = { authType: 'youtube_oauth', accessToken: 'fixture-google-access', refreshToken: 'fixture-google-refresh' };
const channel = { platformName: 'YouTube', url: 'https://youtube.com/@alice', providerChannelId: id };
const state = 'c'.repeat(64), verifier = 'v'.repeat(64);
const tokenResponse = (patch = {}) => ({ access_token: credentials.accessToken, refresh_token: credentials.refreshToken, token_type: 'Bearer', expires_in: 3600, scope: youtubeReadonlyScope, ...patch });
const profile = { id, snippet: { title: 'Alice' }, statistics: { videoCount: '1', viewCount: '123', subscriberCount: '7' }, contentDetails: { relatedPlaylists: { uploads: 'uploads' } } };
const json = (body, status = 200) => Response.json(body, { status });

function oauthFetch(tokenPatch = {}, mine = { items: [{ id }] }, seen = []) {
  return async (url, init) => {
    const u = new URL(url); seen.push(u.pathname);
    assert.equal(init.redirect, 'manual');
    if (u.origin === 'https://oauth2.googleapis.com') {
      assert.equal(u.pathname, '/token'); assert.equal(u.search, '');
      assert.equal(init.method, 'POST');
      assert.equal(init.body.get('client_id'), env.YOUTUBE_CLIENT_ID);
      assert.equal(init.body.get('client_secret'), env.YOUTUBE_CLIENT_SECRET);
      return json(tokenResponse(tokenPatch));
    }
    assert.equal(u.origin, 'https://www.googleapis.com');
    assert.equal(init.headers.Authorization, `Bearer ${tokenPatch.access_token || credentials.accessToken}`);
    assert.equal(u.searchParams.has('key'), false);
    assert.equal(u.searchParams.get('mine'), 'true');
    return json(mine);
  };
}

await test('Google authorization requests only readonly scope, offline consent, exact callback and PKCE; DTOs contain no secrets', async () => {
  const url = new URL(await authorizationUrl('youtube', env, state, verifier));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.pathname, '/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://fixture.example/connect/oauth/youtube/callback');
  assert.equal(url.searchParams.get('scope'), youtubeReadonlyScope);
  assert.equal(url.searchParams.get('state'), state);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent select_account');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), await pkceChallenge(verifier));
  assert.ok(!url.toString().includes(verifier)); assert.ok(!url.toString().includes(env.YOUTUBE_CLIENT_SECRET));
  const readiness = integrationStatus(env).filter((p) => p.id === 'youtube');
  assert.equal(readiness.length, 1); assert.equal(readiness[0].ready, true);
  assert.ok(!JSON.stringify(readiness).includes(env.YOUTUBE_CLIENT_SECRET));
  assert.equal(integrationStatus({ ...env, YOUTUBE_OAUTH_ENABLED: 'false' }).find((p) => p.id === 'youtube').ready, false);
  await assert.rejects(authorizationUrl('youtube', env, state, ''), /заново/);
  assert.throws(() => callbackParams('youtube', `https://fixture.example/cb?state=${state}&state=${state}&code=fixture`), /Неоднозначный/);
});

await test('Google code exchange binds verifier, identifies channel with mine=true and excludes server credentials from stored tokens', async () => {
  const mock = oauthFetch();
  const result = await exchangeCode('youtube', env, { code: 'fixture-code', state }, verifier, { fetchImpl: async (url, init) => {
    if (new URL(url).origin === 'https://oauth2.googleapis.com') {
      assert.equal(init.body.get('code_verifier'), verifier);
      assert.equal(init.body.get('code'), 'fixture-code');
      assert.equal(init.body.get('grant_type'), 'authorization_code');
      assert.equal(init.body.get('redirect_uri'), 'https://fixture.example/connect/oauth/youtube/callback');
    }
    return mock(url, init);
  } });
  assert.equal(result.accountId, id); assert.deepEqual(result.credentials, credentials);
  assert.ok(Date.parse(result.expiresAt) > Date.now());
  assert.ok(!JSON.stringify(result).includes(env.YOUTUBE_CLIENT_SECRET));
  assert.ok(!JSON.stringify(result).includes(env.YOUTUBE_CLIENT_ID));
  assert.deepEqual(parseCredentials(credentials), credentials);
  assert.throws(() => parseCredentials({ ...credentials, authType: 'arbitrary' }), /тип доступа/);
});

await test('Google code exchange rejects missing scope, offline refresh, bearer type, lifetime and ambiguous/no channel', async () => {
  for (const patch of [{ scope: 'openid profile' }, { scope: undefined }, { refresh_token: undefined }, { token_type: 'DPoP' }, { expires_in: 0 }, { expires_in: -1 }]) {
    await assert.rejects(exchangeCode('youtube', env, { code: 'fixture-code' }, verifier, { fetchImpl: oauthFetch(patch) }));
  }
  for (const mine of [{ items: [] }, { items: [{ id }, { id: otherId }] }, { items: [{ id }], nextPageToken: 'more' }, { items: [{ id: 'not-a-channel' }] }]) {
    await assert.rejects(exchangeCode('youtube', env, { code: 'fixture-code' }, verifier, { fetchImpl: oauthFetch({}, mine) }), /Google не подтвердил/);
  }
});

await test('OAuth catalog keeps public-only totals, uses bearer for every request and verifies URL against authenticated channel', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url); requests.push(u);
    assert.equal(init.headers.Authorization, `Bearer ${credentials.accessToken}`);
    assert.equal(u.searchParams.has('key'), false); assert.equal(url.includes(credentials.accessToken), false);
    if (u.pathname.endsWith('/channels')) return json(u.searchParams.has('mine') ? { items: [{ id }] } : { items: [profile] });
    if (u.pathname.endsWith('/playlistItems')) return json({ items: ['public', 'private'].map((videoId) => ({ contentDetails: { videoId } })) });
    return json({ items: [
      { id: 'public', snippet: { channelId: id }, status: { privacyStatus: 'public' }, statistics: { viewCount: '45', likeCount: '3' } },
      { id: 'private', snippet: { channelId: id }, status: { privacyStatus: 'private' }, statistics: { viewCount: '9999', likeCount: '999' } },
    ] });
  };
  const metrics = await collectYouTubeWithPersonalKey(channel, { status: 'connected', accountId: id, credentials }, { fetchImpl });
  assert.equal(metrics.publicationCount, 1); assert.equal(metrics.totalViews, 123); assert.equal(metrics.totalLikes, 3);
  assert.equal(requests.length, 4);
  await assert.rejects(inspectAccess(channel, credentials, { fetchImpl: async (url) => json(new URL(url).searchParams.has('mine') ? { items: [{ id: otherId }] } : { items: [profile] }) }), /другой YouTube-канал/);
});

await test('Google refresh keeps existing refresh token when omitted, verifies authenticated channel, and uses only server env client credentials', async () => {
  const patch = { access_token: 'fixture-refreshed-access', refresh_token: undefined, scope: undefined };
  const mock = oauthFetch(patch);
  const result = await refreshAccess('YouTube', credentials, { env, expectedAccountId: id, fetchImpl: async (url, init) => {
    if (new URL(url).origin === 'https://oauth2.googleapis.com') {
      assert.equal(init.body.get('grant_type'), 'refresh_token');
      assert.equal(init.body.get('refresh_token'), credentials.refreshToken);
    }
    return mock(url, init);
  } });
  assert.deepEqual(result.credentials, { ...credentials, accessToken: patch.access_token });
  assert.ok(!JSON.stringify(result).includes(env.YOUTUBE_CLIENT_SECRET));
  const rotated = await refreshAccess('YouTube', credentials, { env, expectedAccountId: id, fetchImpl: oauthFetch({ refresh_token: 'fixture-rotated-refresh' }) });
  assert.equal(rotated.credentials.refreshToken, 'fixture-rotated-refresh');
  await assert.rejects(refreshAccess('YouTube', credentials, { env, expectedAccountId: otherId, fetchImpl: oauthFetch() }), /другого YouTube-канала/);
  await assert.rejects(refreshAccess('YouTube', credentials, { env, expectedAccountId: id, fetchImpl: oauthFetch({ scope: 'openid' }) }), /разрешение/);
  await assert.rejects(refreshAccess('YouTube', credentials, { env, expectedAccountId: id, fetchImpl: oauthFetch({ expires_in: 0 }) }), /продление/);
});

await test('expired/revoked OAuth and absent refresh require Google login; missing app config is retryable and old API keys never refresh', async () => {
  await assert.rejects(collectAuthorized(channel, { accountId: id, credentials }, { fetchImpl: async () => json({ error: { code: 401, message: credentials.accessToken, errors: [{ reason: 'authError' }] } }, 401) }), (error) => error.syncStatus === 'needs_auth' && /Google/.test(error.message) && !error.message.includes(credentials.accessToken));
  for (const [body, expectedStatus] of [[{ error: 'invalid_grant', error_description: credentials.refreshToken }, 'needs_auth'], [{ error: 'invalid_client', error_description: env.YOUTUBE_CLIENT_SECRET }, 'error']]) {
    await assert.rejects(refreshAccess('YouTube', credentials, { env, expectedAccountId: id, fetchImpl: async () => json(body, 400) }), (error) => error.syncStatus === expectedStatus && !JSON.stringify(body).includes(error.message) && !error.message.includes(credentials.refreshToken) && !error.message.includes(env.YOUTUBE_CLIENT_SECRET));
  }
  const forbidden = async () => assert.fail('No network without valid refresh prerequisites');
  await assert.rejects(refreshAccess('YouTube', { ...credentials, refreshToken: undefined }, { env, expectedAccountId: id, fetchImpl: forbidden }), (error) => error.syncStatus === 'needs_auth');
  await assert.rejects(refreshAccess('YouTube', credentials, { expectedAccountId: id, fetchImpl: forbidden }), (error) => error.syncStatus === 'error');
  assert.equal(await refreshAccess('YouTube', { accessToken: 'fixture-legacy-api-key' }, { env, fetchImpl: forbidden }), null);
});

await test('Google exchange and refresh reject redirects without following Location or leaking response tokens', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return json({ access_token: 'sensitive-redirect-token' }, 307); };
  await assert.rejects(exchangeCode('youtube', env, { code: 'fixture-code' }, verifier, { fetchImpl }), (error) => !error.message.includes('sensitive'));
  await assert.rejects(refreshAccess('YouTube', credentials, { env, expectedAccountId: id, fetchImpl }), (error) => error.syncStatus === 'error' && !error.message.includes('sensitive'));
  assert.equal(calls, 2);
});
