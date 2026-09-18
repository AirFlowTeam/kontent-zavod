import test from 'node:test';
import assert from 'node:assert/strict';
import { collectAuthorized, inspectAccess } from '../lib/social-api.mjs';

const id = 'UC1234567890123456789012';
const credentials = { accessToken: 'youtube-catalog-fixture-key' };
const channel = { platformName: 'YouTube', url: 'https://youtube.com/@alice', providerChannelId: id };
const profile = (count) => ({ id, snippet: { title: 'Alice' }, statistics: { videoCount: String(count), viewCount: '123456', subscriberCount: '12300' }, contentDetails: { relatedPlaylists: { uploads: 'uploads' } } });
const video = (videoId, patch = {}) => ({ id: videoId, snippet: { channelId: id }, status: { privacyStatus: 'public' }, statistics: { likeCount: '2' }, ...patch });

test('YouTube reads all upload pages, deduplicates overlap and batches video statistics at 50 IDs', async () => {
  const ids = Array.from({ length: 101 }, (_, i) => `video-${i}`);
  const pages = [ids.slice(0, 50), ids.slice(49, 99), ids.slice(99)];
  const tokens = []; const batches = [];
  const metrics = await collectAuthorized(channel, { accountId: id, credentials }, { fetchImpl: async (url) => {
    const u = new URL(url); const method = u.pathname.split('/').at(-1);
    if (method === 'channels') { assert.equal(u.searchParams.get('id'), id); return Response.json({ items: [profile(101)] }); }
    if (method === 'playlistItems') {
      assert.equal(u.searchParams.get('maxResults'), '50');
      const token = u.searchParams.get('pageToken'); tokens.push(token);
      const index = token === null ? 0 : Number(token);
      return Response.json({ items: pages[index].map((videoId) => ({ contentDetails: { videoId } })), ...(index < 2 ? { nextPageToken: String(index + 1) } : {}) });
    }
    assert.equal(method, 'videos');
    const batch = u.searchParams.get('id').split(','); batches.push(batch);
    assert.ok(batch.length <= 50);
    return Response.json({ items: batch.map((videoId) => video(videoId)) });
  } });
  assert.deepEqual(tokens, [null, '1', '2']);
  assert.deepEqual(batches.map((batch) => batch.length), [50, 50, 1]);
  assert.equal(new Set(batches.flat()).size, 101);
  assert.equal(metrics.totalViews, 123456); assert.equal(metrics.publicationCount, 101);
  assert.equal(metrics.totalLikes, 202); assert.equal(metrics.followers, 12300);
});

test('YouTube total likes stay unknown when any own public video or like count is missing', async () => {
  for (const item of [null, video('v1', { snippet: { channelId: 'UC0000000000000000000000' } }), video('v1', { status: { privacyStatus: 'unlisted' } }), video('v1', { statistics: {} })]) {
    const metrics = await collectAuthorized(channel, { accountId: id, credentials }, { fetchImpl: async (url) => {
      const method = new URL(url).pathname.split('/').at(-1);
      if (method === 'channels') return Response.json({ items: [profile(1)] });
      if (method === 'playlistItems') return Response.json({ items: [{ contentDetails: { videoId: 'v1' } }] });
      return Response.json({ items: item ? [item] : [] });
    } });
    assert.equal(metrics.totalViews, 123456); assert.equal(metrics.publicationCount, 1);
    assert.equal(metrics.totalLikes, null);
  }
});

test('YouTube repeated upload cursors fail without publishing a partial total', async () => {
  let page = 0;
  await assert.rejects(collectAuthorized(channel, { credentials }, { fetchImpl: async (url) => {
    const method = new URL(url).pathname.split('/').at(-1);
    if (method === 'channels') return Response.json({ items: [profile(3)] });
    assert.equal(method, 'playlistItems');
    return Response.json({ items: [{ contentDetails: { videoId: `v${page++}` } }], nextPageToken: 'repeated' });
  } }), (error) => error.syncStatus === 'error' && /повтор страницы/.test(error.message));
  assert.equal(page, 2);
});

test('YouTube stable channel ID wins over a changed handle; legacy names use forUsername', async () => {
  for (const [input, filter, value] of [
    [channel, 'id', id],
    [{ ...channel, providerChannelId: null }, 'forHandle', '@alice'],
    [{ ...channel, providerChannelId: null, url: 'https://youtube.com/user/legacy' }, 'forUsername', 'legacy'],
    [{ ...channel, url: 'https://youtube.com/c/legacy' }, 'id', id],
  ]) {
    await inspectAccess(input, credentials, { fetchImpl: async (url) => {
      assert.equal(new URL(url).searchParams.get(filter), value);
      return Response.json({ items: [profile(1)] });
    } });
  }
  await assert.rejects(inspectAccess({ ...channel, providerChannelId: null, url: 'https://youtube.com/c/legacy' }, credentials, {
    fetchImpl: async () => { assert.fail('Legacy custom URLs must not guess another handle'); },
  }), /\/@handle/);
});
