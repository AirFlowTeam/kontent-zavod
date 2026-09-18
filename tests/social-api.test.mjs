import test from 'node:test';
import assert from 'node:assert/strict';
import { collectAuthorized, inspectAccess, refreshAccess, verifyReadAccess, SocialApiError } from '../lib/social-api.mjs';
import { classifyProviderError } from '../scripts/channel-parser-lib.mjs';
const credentials = { accessToken: 'fixture-access-token', refreshToken: 'fixture-refresh-token', clientId: '123', deviceId: 'device' };
const response = (data, status = 200) => Response.json(data, { status });
const igChannel = { platformName: 'Instagram', url: 'https://instagram.com/alice' };
const igProfile = { user_id: '123', username: 'alice', media_count: 2, followers_count: 10 };

test('Instagram full pagination counts only VIDEO, requires owner/type, null is not zero', async () => {
  const mock = (patch = {}) => async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/me')) return response(igProfile);
    if (u.pathname.endsWith('/media')) return response({ data: u.searchParams.has('after') ? [{ id: '2', media_type: 'IMAGE', owner: { id: '123' } }] : [{ id: '1', owner: { id: '123' }, media_type: 'VIDEO', like_count: 0, ...patch }], paging: u.searchParams.has('after') ? {} : { next: 'https://evil.invalid/no-follow', cursors: { after: 'page2' } } });
    return response({ data: [{ name: 'views', period: 'lifetime', values: [{ value: 15 }] }] });
  };
  const result = await collectAuthorized(igChannel, { accountId: '123', credentials }, { fetchImpl: mock() });
  assert.equal(result.publicationCount, 1); assert.equal(result.totalViews, 15); assert.equal(result.totalLikes, 0);
  assert.equal((await collectAuthorized(igChannel, { accountId: '123', credentials }, { fetchImpl: mock({ like_count: false }) })).totalLikes, null);
  await assert.rejects(collectAuthorized(igChannel, { credentials }, { fetchImpl: mock({ owner: { id: '456' } }) }), /владельца/);
  await assert.rejects(collectAuthorized(igChannel, { credentials }, { fetchImpl: mock({ media_type: null }) }), /тип/);
  await assert.rejects(inspectAccess({ ...igChannel, url: 'https://instagram.com/bob' }, credentials, { fetchImpl: mock() }), /другому/);
});

test('TikTok complete video list, API identity distinct from public secUid; count mismatch rejects', async () => {
  const channel = { platformName: 'TikTok', url: 'https://tiktok.com/@alice', providerChannelId: 'public-secUid' };
  const mock = (count = 2) => async (url, init) => {
    if (new URL(url).pathname.includes('user/info')) return response({ data: { user: { open_id: 'openid', username: 'alice', video_count: count, likes_count: 3 } }, error: { code: 'ok' } });
    const body = JSON.parse(init.body);
    return response({ data: body.cursor ? { videos: [{ id: '2', view_count: 20 }], has_more: false } : { videos: [{ id: '1', view_count: 10 }], has_more: true, cursor: 100 }, error: { code: 'ok' } });
  };
  const result = await collectAuthorized(channel, { accountId: 'openid', credentials }, { fetchImpl: mock() });
  assert.equal(result.totalViews, 30); assert.equal(result.totalLikes, 3); assert.equal(result.publicationCount, 2);
  assert.equal(result.providerChannelId, undefined);
  await assert.rejects(collectAuthorized(channel, { accountId: 'openid', credentials }, { fetchImpl: mock(1) }), /число видео/);
});

test('VK excludes saved foreign videos; missing/duplicate pages never become full sums', async () => {
  const channel = { platformName: 'VK', url: 'https://vk.com/id123', providerChannelId: '123' };
  const mock = (mode = '') => async (url, init) => {
    const method = new URL(url).pathname.split('/').at(-1); const body = new URLSearchParams(init.body);
    if (method === 'users.get') return response({ response: [{ id: 123 }] });
    if (body.get('count') === '1') return response({ response: { count: 2, items: [] } });
    return response({ response: { count: mode === 'duplicate' ? 400 : 2, items: mode === 'empty' ? [] : [{ id: 1, owner_id: 123, views: 10, likes: { count: 2 } }, { id: 2, owner_id: 789, views: 900, likes: { count: 90 } }] } });
  };
  const result = await collectAuthorized(channel, { accountId: '123', credentials }, { fetchImpl: mock() });
  assert.equal(result.totalViews, 10); assert.equal(result.totalLikes, 2); assert.equal(result.publicationCount, 1);
  await assert.rejects(collectAuthorized(channel, { credentials }, { fetchImpl: mock('empty') }), /скрыл/);
  await assert.rejects(collectAuthorized(channel, { credentials }, { fetchImpl: mock('duplicate') }), /повторил/);
  await assert.rejects(inspectAccess({ ...channel, url: 'https://vk.com/id789' }, credentials, { fetchImpl: mock() }), /другому/);
});

test('YouTube full public likes, missing statistics remain unknown', async () => {
  const id = 'UC1234567890123456789012';
  const mock = (likeCount = 3) => async (url) => {
    const method = new URL(url).pathname.split('/').at(-1);
    if (method === 'channels') return response({ items: [{ id, snippet: { title: 'Alice' }, statistics: { videoCount: '1', viewCount: '12' }, contentDetails: { relatedPlaylists: { uploads: 'uploads' } } }] });
    if (method === 'playlistItems') return response({ items: [{ contentDetails: { videoId: 'v1' } }] });
    return response({ items: [{ id: 'v1', snippet: { channelId: id }, status: { privacyStatus: 'public' }, statistics: { likeCount } }] });
  };
  const channel = { platformName: 'YouTube', url: 'https://youtube.com/@alice' };
  const r = await collectAuthorized(channel, { credentials }, { fetchImpl: mock() });
  assert.equal(r.totalViews, 12); assert.equal(r.totalLikes, 3);
  assert.equal((await collectAuthorized(channel, { credentials }, { fetchImpl: mock(null) })).totalLikes, null);
});

test('refresh verifies returned provider identity/state and preserves rotating tokens', async () => {
  const tt = await refreshAccess('TikTok', credentials, { expectedAccountId: 'a', tiktokClientKey: 'key', tiktokClientSecret: 'secret', fetchImpl: async () => response({ open_id: 'a', access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 86400 }) });
  assert.equal(tt.credentials.refreshToken, 'rotated-refresh');
  await assert.rejects(refreshAccess('TikTok', credentials, { expectedAccountId: 'b', tiktokClientKey: 'key', tiktokClientSecret: 'secret', fetchImpl: async () => response({ open_id: 'a', access_token: 'rotated-access', expires_in: 86400 }) }), /другого/);
  const vk = await refreshAccess('VK', credentials, { expectedAccountId: '123', fetchImpl: async (_, init) => response({ user_id: 123, state: new URLSearchParams(init.body).get('state'), access_token: 'new-access-token', refresh_token: 'new-refresh-token', expires_in: 3600 }) });
  assert.equal(vk.credentials.refreshToken, 'new-refresh-token');
  await assert.rejects(refreshAccess('VK', credentials, { expectedAccountId: '123', fetchImpl: async () => response({ user_id: 123, state: 'wrong', access_token: 'new-access-token', expires_in: 3600 }) }), /состояние/);
});

test('provider errors do not leak credentials; quotas are retryable, not needs_auth', async () => {
  for (const body of [{ error: { error_code: 6, request_params: credentials } }, { error: { errors: [{ reason: 'quotaExceeded' }], message: credentials.accessToken } }]) {
    await assert.rejects(inspectAccess({ platformName: 'YouTube', url: 'https://youtube.com/@alice' }, credentials, { fetchImpl: async () => response(body, 403) }), (e) => {
      assert.ok(e instanceof SocialApiError); assert.equal(classifyProviderError(e), 'error'); assert.ok(!e.message.includes(credentials.accessToken)); return true;
    });
  }
});

test('VK authorized stats include profile followers and community members', async () => {
  for (const group of [false, true]) {
    const result = await collectAuthorized({ platformName: 'VK', url: `https://vk.com/${group ? 'club456' : 'id123'}` }, { credentials }, { fetchImpl: async (url, init) => {
      const method = new URL(url).pathname.split('/').at(-1), body = new URLSearchParams(init.body);
      if (method === 'users.get') {
        assert.match(body.get('fields'), /followers_count/);
        return response({ response: [{ id: 123, followers_count: 42, first_name: 'Alice', last_name: 'Creator' }] });
      }
      if (method === 'groups.getById') {
        assert.match(body.get('fields'), /members_count/);
        return response({ response: { groups: [{ id: 456, is_admin: 1, members_count: 97, name: 'Alice videos' }] } });
      }
      return response({ response: { count: 0, items: [] } });
    } });
    assert.equal(result.followers, group ? 97 : 42);
    assert.equal(result.title, group ? 'Alice videos' : 'Alice Creator');
    assert.equal(result.totalViews, 0);
  }
});

test('YouTube permission probe checks uploads and video stats; empty channels remain valid', async () => {
  const channel = { platformName: 'YouTube', url: 'https://youtube.com/@alice' }, id = 'UC1234567890123456789012';
  const calls = [];
  const fetchImpl = async (url) => {
    const method = new URL(url).pathname.split('/').at(-1); calls.push(method);
    if (method === 'channels') return response({ items: [{ id, statistics: { videoCount: '1' }, contentDetails: { relatedPlaylists: { uploads: 'uploads' } } }] });
    if (method === 'playlistItems') return response({ items: [{ contentDetails: { videoId: 'v1' } }] });
    return response({ error: { errors: [{ reason: 'accessNotConfigured' }] } }, 403);
  };
  await assert.rejects(verifyReadAccess(channel, credentials, { fetchImpl }), /YouTube Data API v3 выключен/);
  assert.deepEqual(calls, ['channels', 'playlistItems', 'videos']);
  const empty = async () => response({ items: [{ id, statistics: { videoCount: '0', viewCount: '0', subscriberCount: '0' } }] });
  await verifyReadAccess(channel, credentials, { fetchImpl: empty });
  const result = await collectAuthorized(channel, { credentials }, { fetchImpl: empty });
  assert.equal(result.publicationCount, 0); assert.equal(result.totalLikes, 0); assert.equal(result.followers, 0);
});

test('provider errors return specific safe recovery actions instead of raw provider messages', async () => {
  const cases = [
    ['YouTube', 'https://youtube.com/@alice', { error: { errors: [{ reason: 'accessNotConfigured' }] } }, /Library/],
    ['YouTube', 'https://youtube.com/@alice', { error: { details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } }, /IP сервера/],
    ['TikTok', 'https://tiktok.com/@alice', { error: { code: 'scope_not_authorized' } }, /video.list/],
    ['VK', 'https://vk.com/id123', { error: { error_code: 7 } }, /правом video/],
    ['Instagram', 'https://instagram.com/alice', { error: { code: 190 } }, /instagram_business_manage_insights/],
  ];
  for (const [platformName, url, body, expected] of cases) {
    body.error.message = credentials.accessToken;
    await assert.rejects(inspectAccess({ platformName, url }, credentials, { fetchImpl: async () => response(body, 403) }), (error) => {
      assert.match(error.message, expected); assert.ok(!error.message.includes(credentials.accessToken)); assert.equal(error.syncStatus, 'needs_auth'); return true;
    });
  }
});
