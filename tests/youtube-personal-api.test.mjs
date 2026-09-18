import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectYouTubeWithPersonalKey } from '../scripts/youtube-personal-api.mjs';
import { collectConnectedChannel } from '../scripts/authorized-channel-sync.mjs';
import { collectAuthorized, verifyReadAccess, SocialApiError } from '../lib/social-api.mjs';
import { classifyProviderError, ensureMetrics } from '../scripts/channel-parser-lib.mjs';

const id = 'UC1234567890123456789012';
const channel = { id: 7, platformName: 'YouTube', url: 'https://youtube.com/@alice', leaseToken: 'fixture-lease' };
const connection = { status: 'connected', accountId: id, version: 'fixture-version', credentials: { accessToken: 'personal-fixture-key' } };
const profile = (videoCount) => ({ id, statistics: { videoCount, viewCount: '0', subscriberCount: '1' }, contentDetails: { relatedPlaylists: { uploads: 'not-created-yet' } } });

await test('empty YouTube with advertised but nonexistent uploads playlist accepts the key and records exact zero public totals', async () => {
  const methods = [];
  const options = { fetchImpl: async (url) => {
    const method = new URL(url).pathname.split('/').at(-1); methods.push(method);
    if (method === 'channels') return Response.json({ items: [profile('0')] });
    return Response.json({ error: { errors: [{ reason: 'playlistNotFound' }] } }, { status: 404 });
  } };
  await verifyReadAccess(channel, connection.credentials, options);
  const metrics = await collectYouTubeWithPersonalKey(channel, connection, options);
  assert.deepEqual(methods, ['channels', 'channels']);
  assert.equal(metrics.totalViews, 0); assert.equal(metrics.totalLikes, 0);
  assert.equal(metrics.publicationCount, 0); assert.equal(metrics.followers, 1);
});

await test('unknown or nonzero YouTube counts never become zero when uploads are missing', async () => {
  for (const count of [undefined, '1']) {
    for (const operation of [verifyReadAccess, (ch, credentials, options) => collectAuthorized(ch, { credentials }, options)]) {
      await assert.rejects(operation(channel, connection.credentials, { fetchImpl: async (url) => new URL(url).pathname.endsWith('/channels')
        ? Response.json({ items: [profile(count)] })
        : Response.json({ error: { errors: [{ reason: 'playlistNotFound' }] } }, { status: 404 }) }),
      (error) => error.syncStatus === 'error' && /каталог публичных загрузок/.test(error.message));
    }
  }
});

await test('collector requires a connected personal YouTube key and never attempts shared, anonymous or yt-dlp fallback', async () => {
  const source = readFileSync(new URL('../scripts/channel-sync.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function processChannel(channel)');
  const end = source.indexOf('\nasync function run()', start);
  assert.ok(start > 0 && end > start);
  const cases = [null, { ...connection, status: 'needs_auth' }, connection];
  for (const stored of cases) {
    const reports = []; const requests = []; const keys = []; let fallbackCalls = 0;
    const forbidden = async () => { fallbackCalls++; throw new Error('Unexpected fallback'); };
    const bindings = {
      process: { env: { YOUTUBE_API_KEY: 'configured-shared-fixture-key' } },
      stopping: false, commandTimeoutMs: 180000, requestSignal: () => undefined,
      syncRequest: async (body) => { requests.push(body); return { connection: stored, version: 'updated-version' }; },
      reportResult: async (body) => { reports.push(body); },
      collectConnectedChannel: (ch, c, options) => collectConnectedChannel(ch, c, { ...options, fetchImpl: async (url) => {
        keys.push(new URL(url).searchParams.get('key'));
        return Response.json({ error: { errors: [{ reason: 'API_KEY_INVALID' }], message: 'personal-fixture-key' } }, { status: 403 });
      } }),
      collectAuthorized: forbidden, refreshAccess: forbidden, fetchPublicProfile: forbidden,
      parseRutubePublicProfile: forbidden, runYtDlp: forbidden, parseVkProfile: forbidden,
      SocialApiError, classifyProviderError, ensureMetrics,
      compactError: (value) => String(value), console: { error() {}, log() {} },
    };
    // Test-only evaluation of our own collector function, with provider/transport
    // boundaries replaced; no daemon, environment credentials or network runs.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function(...Object.keys(bindings), `${source.slice(start, end)}; return processChannel;`)(...Object.values(bindings));
    await run(channel);
    assert.equal(fallbackCalls, 0); assert.equal(reports.length, 1);
    assert.equal(reports[0].action, 'fail'); assert.equal(reports[0].status, 'needs_auth');
    assert.ok(!reports[0].error.includes('personal-fixture-key'));
    assert.deepEqual(keys, stored?.status === 'connected' ? ['personal-fixture-key'] : []);
    assert.equal(requests.filter((body) => body.action === 'updateConnection').length, stored ? 1 : 0);
  }
});

await test('successful personal YouTube uses only the saved key and pins the stored channel identity', async () => {
  const keys = [];
  const metrics = await collectYouTubeWithPersonalKey(channel, connection, { fetchImpl: async (url) => {
    keys.push(new URL(url).searchParams.get('key'));
    return Response.json({ items: [profile('0')] });
  } });
  assert.deepEqual(keys, ['personal-fixture-key']); assert.equal(metrics.providerChannelId, id);
  await assert.rejects(collectYouTubeWithPersonalKey(channel, connection, { fetchImpl: async () => Response.json({ items: [{ ...profile('0'), id: 'UC0000000000000000000000' }] }) }), /Владелец API-доступа изменился/);
});

await test('unknown YouTube channels request a corrected link instead of replacing a valid key', async () => {
  for (const [payload, status] of [[{ items: [] }, 200], [{ error: { errors: [{ reason: 'channelNotFound' }] } }, 404]]) {
    await assert.rejects(collectYouTubeWithPersonalKey(channel, connection, { fetchImpl: async () => Response.json(payload, { status }) }),
      (error) => error.syncStatus === 'error' && /исправьте ссылку/.test(error.message));
  }
});
