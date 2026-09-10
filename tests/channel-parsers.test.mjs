import test from 'node:test';
import assert from 'node:assert/strict';
import { asNonNegativeInteger, mapYtDlpResult, parseTikTokHtml, parseInstagramHtml, ytDlpChannelUrl, classifyProviderError } from '../scripts/channel-parser-lib.mjs';
import { fetchPublicProfile, parseVkProfile } from '../scripts/channel-providers.mjs';
import { runYtDlp } from '../scripts/yt-dlp-runner.mjs';

const tikChannel = { platformName: 'TikTok', url: 'https://www.tiktok.com/@fixture' };
const tikHtml = (overrides = {}) => `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.user-detail': { userInfo: {
  user: { uniqueId: 'fixture', secUid: 'stable', nickname: 'Креатор' }, stats: { followerCount: 96000000, videoCount: 20 }, statsV2: { followerCount: '95677832', videoCount: '0' }, ...overrides,
} } } })}</script>`;
const instagram = (user) => `<script type="application/json">${JSON.stringify({ data: { xig_user_by_username: { username: 'fixture', pk: '25025320', id: 'other-namespace', follower_count: 0, all_media_count: null, ...user } } })}</script>`;

test('numeric parser distinguishes true zero, missing, malformed and overflow', () => {
  for (const value of [null, undefined, '', ' ', false, {}, -1, 1.1, '1M', '1e3', Number.MAX_SAFE_INTEGER + 1]) assert.equal(asNonNegativeInteger(value), null);
  for (const value of [0, '0', ' 0 ']) assert.equal(asNonNegativeInteger(value), 0);
  assert.equal(asNonNegativeInteger('95677832'), 95677832);
});
test('yt-dlp rejects single videos, empty data and all-missing channel statistics', () => {
  for (const info of [{}, [], null, { _type: 'playlist', entries: [] }, { id: 'video', formats: [], view_count: 100 }, { _type: 'multi_video', view_count: 100 }]) assert.throws(() => mapYtDlpResult(info));
});
test('yt-dlp never sums sampled video views or calls that 30-day reach', () => {
  const result = mapYtDlpResult({ _type: 'playlist', channel_follower_count: 0, entries: [{ view_count: 100 }, {}] });
  assert.equal(result.followers, 0);
  assert.equal(result.totalViews, null);
  assert.equal(result.publicationCount, null);
  assert.equal(result.reach30d, null);
});
test('yt-dlp container playlist counts are not upload counts; VK stable owner ID', () => {
  const result = mapYtDlpResult({ _type: 'playlist', id: '-123_all', channel_follower_count: 1, playlist_count: 5, entries: [{ _type: 'playlist' }] }, { platformName: 'VK' });
  assert.equal(result.providerChannelId, '-123');
  assert.equal(result.publicationCount, null);
  assert.equal(ytDlpChannelUrl({ platformName: 'VK', url: 'https://vk.com/fixture' }), 'https://vkvideo.ru/@fixture');
});
test('TikTok exact statsV2 preferred; likes never become views', () => {
  const result = parseTikTokHtml(tikHtml(), tikChannel);
  assert.equal(result.followers, 95677832);
  assert.equal(result.publicationCount, 0);
  assert.equal(result.providerChannelId, 'stable');
  assert.equal(result.totalViews, null);
});
test('TikTok wrong profile, private and malformed response fail explicitly', () => {
  assert.throws(() => parseTikTokHtml(tikHtml({ user: { uniqueId: 'other' } }), tikChannel), /другой/);
  assert.throws(() => parseTikTokHtml(tikHtml({ user: { uniqueId: 'fixture', privateAccount: true } }), tikChannel), (e) => classifyProviderError(e) === 'needs_auth');
  assert.throws(() => parseTikTokHtml('<html>blocked</html>', tikChannel));
});
test('Instagram exact matching profile and stable pk; unknown is not zero', () => {
  const result = parseInstagramHtml(instagram({ username: 'other', follower_count: 10 }) + instagram({}), { url: 'https://instagram.com/fixture' });
  assert.equal(result.providerChannelId, '25025320');
  assert.equal(result.followers, 0);
  assert.equal(result.publicationCount, null);
  assert.throws(() => parseInstagramHtml(instagram({ is_private: true }), { url: 'https://instagram.com/fixture' }), (e) => classifyProviderError(e) === 'needs_auth');
});
test('profile HTTP redirects remain within expected HTTPS domain', async () => {
  for (const location of ['https://attacker.example/fixture', 'http://tiktok.com/@fixture', 'https://www.tiktok.com:8443/@fixture']) {
    let calls = 0;
    await assert.rejects(fetchPublicProfile(tikChannel, { fetchImpl: async () => { calls++; return new Response('', { status: 302, headers: { location } }); } }), /домена/);
    assert.equal(calls, 1);
  }
  await assert.rejects(fetchPublicProfile(tikChannel, { fetchImpl: async () => new Response('', { status: 302 }) }), /перенаправление/);
});
test('public HTTP errors and large responses do not become success', async () => {
  for (const [status, kind] of [[401, 'needs_auth'], [403, 'needs_auth'], [429, 'error'], [500, 'error']]) {
    await assert.rejects(fetchPublicProfile(tikChannel, { fetchImpl: async () => new Response('', { status }) }), (e) => classifyProviderError(e) === kind);
  }
  await assert.rejects(fetchPublicProfile(tikChannel, { fetchImpl: async () => new Response('x'.repeat(8_000_001)) }), /слишком большой/);
  const result = await fetchPublicProfile(tikChannel, { fetchImpl: async () => new Response(tikHtml()) });
  assert.equal(result.followers, 95677832);
});
test('VK current and legacy group envelopes, zero followers, stable signed ID', async () => {
  for (const envelope of [(p) => ({ groups: [p] }), (p) => [p]]) {
    const methods = [];
    const result = await parseVkProfile({ url: 'https://vk.com/fixture' }, { token: 'fixture-token', fetchImpl: async (url, init) => {
      methods.push(url.split('/').at(-1));
      assert.equal(init.method, 'POST');
      return Response.json({ response: methods.length === 1 ? { type: 'group', object_id: 123 } : envelope({ id: 123, name: 'Group', members_count: 0, counters: { videos: 99 } }) });
    } });
    assert.equal(result.followers, 0);
    assert.equal(result.providerChannelId, '-123');
    assert.equal(result.publicationCount, null);
    assert.deepEqual(methods, ['utils.resolveScreenName', 'groups.getById']);
  }
});
test('VK denied authorization, mismatched identity and missing token', async () => {
  assert.equal(await parseVkProfile({ url: 'https://vk.com/club123' }, {}), null);
  await assert.rejects(parseVkProfile({ url: 'https://vk.com/club123' }, { token: 'x', fetchImpl: async () => Response.json({ error: { error_code: 5 } }) }), (e) => classifyProviderError(e) === 'needs_auth');
  await assert.rejects(parseVkProfile({ url: 'https://vk.com/club123' }, { token: 'x', fetchImpl: async () => Response.json({ response: [{ id: 456 }] }) }), /другой/);
});
test('runner handles unavailable executable and pre-aborted request', async () => {
  await assert.rejects(runYtDlp('https://youtube.com/@fixture', { binary: '/nonexistent-fixture-binary' }), /запустить/);
  await assert.rejects(runYtDlp('https://youtube.com/@fixture', { signal: AbortSignal.abort() }), /остановлен/);
});
