import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectConnectedChannel } from '../scripts/authorized-channel-sync.mjs';
import { classifyProviderError, ensureMetrics } from '../scripts/channel-parser-lib.mjs';

const channelId = 'UC1234567890123456789012';
const channel = { id: 7, platformName: 'YouTube', url: 'https://youtube.com/@alice', leaseToken: 'fixture-lease' };
const env = { YOUTUBE_CLIENT_ID: 'fixture-client', YOUTUBE_CLIENT_SECRET: 'fixture-secret', YOUTUBE_API_KEY: 'forbidden-shared-key' };
const credentials = { authType: 'youtube_oauth', accessToken: 'fixture-old-access', refreshToken: 'fixture-refresh-token' };
const connection = { status: 'connected', accountId: channelId, credentials, version: 'fixture-old-version', expiresAt: '2000-01-01T00:00:00.000Z' };
const profile = { id: channelId, snippet: { customUrl: '@alice' }, statistics: { videoCount: '0', viewCount: '0' } };
const json = (body, status = 200) => Response.json(body, { status });

function googleFetch(events, { onCatalog, tokenError } = {}) {
  return async (url, init) => {
    const u = new URL(url);
    assert.equal(u.searchParams.has('key'), false);
    if (u.origin === 'https://oauth2.googleapis.com') {
      events.push('refresh');
      assert.equal(init.body.get('client_secret'), env.YOUTUBE_CLIENT_SECRET);
      if (tokenError) return json({ error: tokenError }, 400);
      return json({ access_token: 'fixture-new-access', token_type: 'Bearer', expires_in: 3600 });
    }
    assert.equal(init.headers.Authorization, 'Bearer fixture-new-access');
    if (u.searchParams.has('mine')) { events.push('identity'); return json({ items: [{ id: channelId }] }); }
    events.push('catalog');
    if (onCatalog) return onCatalog();
    return json({ items: [profile] });
  };
}

await test('official collector rejects absent/revoked connections before any provider request or credential rotation', async () => {
  for (const platformName of ['YouTube', 'TikTok', 'Instagram', 'Threads', 'VK']) {
    for (const stored of [null, { ...connection, status: 'needs_auth' }, { ...connection, credentials: {} }]) {
      await assert.rejects(collectConnectedChannel({ ...channel, platformName }, stored, {
        env, fetchImpl: async () => assert.fail('Provider must not be called'), saveConnection: async () => assert.fail('Vault must not be written'),
      }), (error) => error.syncStatus === 'needs_auth');
    }
  }
});

await test('Google refresh is triggered by expired, soon-expiring or missing expiry and is saved before collecting', async () => {
  for (const expiresAt of [null, 'invalid', connection.expiresAt, new Date(Date.now() + 60_000).toISOString()]) {
    const events = [];
    const result = await collectConnectedChannel(channel, { ...connection, expiresAt }, {
      env, fetchImpl: googleFetch(events),
      saveConnection: async (updated, version) => {
        events.push('save'); assert.equal(version, connection.version);
        assert.equal(updated.credentials.authType, 'youtube_oauth');
        assert.equal(updated.credentials.refreshToken, credentials.refreshToken);
        assert.equal(updated.credentials.accessToken, 'fixture-new-access');
        assert.ok(Date.parse(updated.expiresAt) > Date.now());
        assert.ok(!JSON.stringify(updated).includes(env.YOUTUBE_CLIENT_SECRET));
        return { version: 'fixture-new-version' };
      },
    });
    assert.deepEqual(events, ['refresh', 'identity', 'save', 'catalog', 'identity']);
    assert.equal(result.totalViews, 0); assert.equal(result.totalLikes, 0);
  }
});

await test('fresh Google OAuth and legacy per-channel API keys collect without refreshing or using the server key', async () => {
  for (const oauth of [false, true]) {
    let requests = 0;
    const personal = oauth ? credentials : { accessToken: 'fixture-personal-api-key' };
    const result = await collectConnectedChannel(channel, { ...connection, credentials: personal, expiresAt: oauth ? new Date(Date.now() + 3_600_000).toISOString() : null }, {
      env, saveConnection: async () => assert.fail('Fresh token/key must not rotate'), fetchImpl: async (url, init) => {
        requests++; const u = new URL(url);
        assert.equal(u.origin, 'https://www.googleapis.com');
        assert.equal(u.pathname, '/youtube/v3/channels');
        if (oauth) { assert.equal(init.headers.Authorization, `Bearer ${credentials.accessToken}`); assert.equal(u.searchParams.has('key'), false); }
        else { assert.equal(u.searchParams.get('key'), personal.accessToken); assert.equal(init.headers, undefined); }
        return json({ items: [profile] });
      },
    });
    assert.equal(requests, oauth ? 2 : 1); assert.equal(result.totalLikes, 0);
  }
});

await test('failed or unacknowledged durable save stops collection after refresh and never falls back', async () => {
  for (const saveConnection of [undefined, async () => ({}), async () => { throw new Error('fixture storage unavailable'); }]) {
    const events = [];
    await assert.rejects(collectConnectedChannel(channel, connection, { env, saveConnection,
      fetchImpl: googleFetch(events, { onCatalog: () => assert.fail('Collection must wait for durable save') }),
    }), (error) => classifyProviderError(error) === 'error');
    assert.deepEqual(events, ['refresh', 'identity']);
  }
});

await test('revoked Google refresh and missing server config remain distinct actionable errors', async () => {
  const events = [];
  await assert.rejects(collectConnectedChannel(channel, connection, { env, fetchImpl: googleFetch(events, { tokenError: 'invalid_grant' }), saveConnection: async () => assert.fail('Invalid refresh must not persist') }), (error) => error.syncStatus === 'needs_auth');
  assert.deepEqual(events, ['refresh']);
  await assert.rejects(collectConnectedChannel(channel, connection, { fetchImpl: async () => assert.fail('No network without app credentials') }), (error) => error.syncStatus === 'error');
});

await test('rotating TikTok refresh is durably saved before profile/video reads, even when subsequent collection fails', async () => {
  const events = [];
  await assert.rejects(collectConnectedChannel({ ...channel, platformName: 'TikTok', url: 'https://tiktok.com/@alice' }, {
    ...connection, accountId: 'fixture-openid', credentials: { accessToken: 'fixture-old-access', refreshToken: 'fixture-old-refresh' },
  }, {
    tiktokClientKey: 'fixture-client', tiktokClientSecret: 'fixture-secret',
    saveConnection: async (updated, version) => { events.push('save'); assert.equal(version, connection.version); assert.equal(updated.credentials.refreshToken, 'fixture-rotated-refresh'); return { version: 'fixture-new-version' }; },
    fetchImpl: async (url, init) => {
      const u = new URL(url);
      if (u.pathname === '/v2/oauth/token/') { events.push('refresh'); return json({ access_token: 'fixture-new-access', refresh_token: 'fixture-rotated-refresh', open_id: 'fixture-openid', expires_in: 3600 }); }
      assert.ok(events.includes('save')); assert.equal(init.headers.Authorization, 'Bearer fixture-new-access');
      if (u.pathname === '/v2/user/info/') { events.push('profile'); return json({ data: { user: { open_id: 'fixture-openid', username: 'alice', video_count: 1 } }, error: { code: 'ok' } }); }
      events.push('videos'); return json({ error: { code: 'scope_not_authorized' } }, 401);
    },
  }), (error) => error.syncStatus === 'needs_auth');
  assert.deepEqual(events, ['refresh', 'save', 'profile', 'videos']);
});

await test('actual collector error path uses saved credential version after refresh and never invalidates access on provider outage', async () => {
  const source = readFileSync(new URL('../scripts/channel-sync.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function processChannel(channel)'), end = source.indexOf('\nasync function run()', start);
  assert.ok(start >= 0 && end > start);
  for (const { httpStatus, reason, authFailure } of [
    { httpStatus: 401, reason: 'authError', authFailure: true },
    { httpStatus: 503, reason: 'authError', authFailure: false },
    { httpStatus: 403, reason: 'accessNotConfigured', authFailure: false },
    { httpStatus: 403, reason: 'SERVICE_DISABLED', authFailure: false },
  ]) {
    const events = [], reports = [], updates = [];
    const fetchImpl = googleFetch(events, { onCatalog: () => json({ error: { code: httpStatus, message: 'provider must not be copied', errors: [{ reason }] } }, httpStatus) });
    const bindings = {
      stopping: false, commandTimeoutMs: 180000, requestSignal: () => undefined, process: { env },
      syncRequest: async (body) => { if (body.action === 'connection') return { connection }; updates.push(body); return { version: 'fixture-marked-version' }; },
      reportResult: async (body) => { reports.push(body); if (body.action === 'updateConnection') { events.push('save'); return { version: 'fixture-saved-version' }; } return { ok: true }; },
      collectConnectedChannel: (ch, conn, options) => collectConnectedChannel(ch, conn, { ...options, fetchImpl }),
      parseRutubePublicProfile: async () => assert.fail('No public fallback'),
      ensureMetrics, classifyProviderError, compactError: String, console: { log() {}, error() {} },
    };
    // Exercise the actual collector function with transport boundaries replaced.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function(...Object.keys(bindings), `${source.slice(start, end)}; return processChannel;`)(...Object.values(bindings));
    await run(channel);
    assert.deepEqual(events, ['refresh', 'identity', 'save', 'catalog']);
    assert.equal(reports[0].action, 'updateConnection'); assert.equal(reports[0].version, connection.version);
    assert.equal(reports[1].action, 'fail'); assert.equal(reports[1].status, authFailure ? 'needs_auth' : 'error');
    assert.ok(!reports[1].error.includes('provider must not be copied'));
    if (httpStatus === 403) {
      assert.match(reports[1].error, /Администратору.*приложении сервиса/);
      assert.doesNotMatch(reports[1].error, /API[- ]?ключ|Google Cloud|проекте ключа|переподключ|войдите заново/i);
    }
    assert.equal(reports.some((r) => r.action === 'complete'), false);
    assert.equal(updates.length, authFailure ? 1 : 0);
    if (authFailure) { assert.equal(updates[0].version, 'fixture-saved-version'); assert.equal(updates[0].status, 'needs_auth'); }
  }
});
